import {
  addOnMessageListener,
  updateCommand,
  addOnCommandListener,
  sendMessageToTab,
  addOnTabActivatedListener,
  addOnTabUpdatedListener,
  addOnTabRemovedListener,
  getActivatedTabs,
  addOnBrowserActionClickListener,
  setBrowserActionTitle,
  setBrowserActionIcon,
  addOnWindowFocusChangedListener,
} from '../../modules/browser';
import api from '../../modules/browser/api';
import {
  KEY_ACTION,
  KEY_COMMAND,
  ACTION_CLOSE_MODAL,
  ACTION_STOP_SCROLLING,
  ACTION_INIT_CONTENT_SCRIPT,
  ACTION_UPDATE_COMMAND,
  MESSAGE_OPEN_MODAL,
  MESSAGE_CLOSE_MODAL,
  MESSAGE_START_SCROLLING,
  MESSAGE_STOP_SCROLLING,
  MESSAGE_CHANGE_SPEED,
  addData as addDataToMessage,
} from '../../modules/messaging';
import { loadOptionItems, initOptionItems } from '../../modules/options';
import { logger, isNotSystemTabWith } from '../../modules/utils';
import ContextMenuScript from '../context-menu';
import State from './state';
import EventType from './event';

import appConst from '../../appConst.json';

const appOpts = appConst.options;
const appBrowseActs = appConst.browserAction;

// NOTE: use browser api out of module
const { TAB_ID_NONE } = api.tabs;
const { WINDOW_ID_NONE } = api.windows;

const DEFAULT_INTERVAL_DOUBLE_CLICK = 500; // mili second
const DEFAULT_DOUBLE_CLICK_TIMER = {
  interval: DEFAULT_INTERVAL_DOUBLE_CLICK,
  timerId: -1,
  isWaiting: false,
};
const DEFAULT_TARGET_TAB = {
  tabId: TAB_ID_NONE,
  windowId: WINDOW_ID_NONE,
  isScrolling: false,
  scrollingSpeed: null,
  isModalOpened: false,
  firedFromEvent: EventType.EVENT_ID_NONE,
};
const DEFAULT_FOCUS_TAB = {
  tabId: TAB_ID_NONE,
  windowId: WINDOW_ID_NONE,
};

class BackgroundScript {
  constructor() {
    this.doubleClickTimer = { ...DEFAULT_DOUBLE_CLICK_TIMER };
    this.targetTab = { ...DEFAULT_TARGET_TAB };
    this.prevTargetTab = { ...this.targetTab };
    this.focusTab = { ...DEFAULT_FOCUS_TAB };
    this.onStateChangeListeners = [];
    this.setState(State.STOP_OR_CLOSE);
    // TODO: maybe need lock mecanizum

    this.onBrowserActionClickListener = this.onBrowserActionClickListener.bind(
      this,
    );
    this.onTabActivatedListener = this.onTabActivatedListener.bind(this);
    this.onWindowFocusChangedListener = this.onWindowFocusChangedListener.bind(
      this,
    );
    this.onTabUpdatedListener = this.onTabUpdatedListener.bind(this);
    this.onTabRemovedListener = this.onTabRemovedListener.bind(this);
    this.onMessageListener = this.onMessageListener.bind(this);
    this.onCommandListener = this.onCommandListener.bind(this);
  }

  init() {
    this.initListeners();
    this.initFocusTab();
    this.updateBrowerAction();

    this.options = initOptionItems(loadOptionItems());
  }

  initFocusTab() {
    this.setFocusTabFromActivateWindow();
  }

  initListeners() {
    addOnBrowserActionClickListener(this.onBrowserActionClickListener);
    addOnTabActivatedListener(this.onTabActivatedListener);
    addOnWindowFocusChangedListener(this.onWindowFocusChangedListener);
    addOnTabUpdatedListener(this.onTabUpdatedListener);
    addOnTabRemovedListener(this.onTabRemovedListener);
    addOnMessageListener(this.onMessageListener);
    addOnCommandListener(this.onCommandListener);
  }

  isStopScrollingOnFocusOut() {
    return this.options.stopScrollingOnFocusOut.value;
  }

  isDisableDoubleClick() {
    return this.options.disableDoubleClick.value;
  }

  isRestoreScrollingFromSwitchBack() {
    return this.options.restoreScrollingFromSwitchBack.value;
  }

  isEnabledTransmissionScrolling() {
    return this.options.enableTransmissionScrolling.value;
  }

  setFocusTabFromActivateWindow(targetWindowId = WINDOW_ID_NONE) {
    const getFocusTab = (windowId, tabs) => {
      if (windowId === WINDOW_ID_NONE) {
        return DEFAULT_FOCUS_TAB;
      }
      const filtered = tabs.filter(tab => tab.windowId === windowId);
      if (filtered.length === 0) {
        const tab = tabs[0];
        return { tabId: tab.id, windowId: tab.windowId };
      }
      const focusTab = filtered[0];
      return { tabId: focusTab.id, windowId: focusTab.windowId };
    };
    return getActivatedTabs().then(tabs => Promise.resolve(this.setFocusTab(
      getFocusTab(targetWindowId, tabs),
    )));
  }

  onMessageListener(message, tab, sendResponse) {
    switch (message[KEY_ACTION]) {
      case ACTION_STOP_SCROLLING:
        this.onReceiveStopMessage();
        break;
      case ACTION_CLOSE_MODAL:
        this.onReceiveCloseMessage();
        break;
      case ACTION_UPDATE_COMMAND:
        updateCommand(message[KEY_COMMAND]);
        break;
      case ACTION_INIT_CONTENT_SCRIPT:
        this.onRecieveInitContentScript();
        break;
      default:
        logger.error(`Invalid action: ${message[KEY_ACTION]}`);
        break;
    }
  }

  onBrowserActionClickListener(tab) {
    try {
      if (this.isDisableDoubleClick()) return this.onSingleClickEvent();
      if (!this.isWaitingDoubleClick()) return this.setDoubleClickTimer();
      return this.clearDoubleClickTimer().onDoubleClickEvent();
    } catch (e) {
      logger.error(e);
    }
    return Promise.resolve();
  }

  onTabActivatedListener(activeInfo) {
    this.setFocusTab(activeInfo);
    try {
      this.onActivateChanged(EventType.TAB_CHANGED);
    } catch (e) {
      logger.error(e);
    }
  }

  onWindowFocusChangedListener(windowId) {
    try {
      this.setFocusTabFromActivateWindow(windowId).then(tab => this
        .onActivateChanged(EventType.WINDOW_CHANGED));
    } catch (e) {
      logger.error(e);
    }
  }

  onTabUpdatedListener(tab) {
    if (this.targetTab.tabId === tab.id) {
      this
        .resetTargetTab(EventType.TAB_UPDATED);
    }
  }

  onTabRemovedListener(tabId) {
    if (this.targetTab.tabId === tabId) {
      this
        .resetTargetTab(EventType.TAB_REMOVED);
    }
  }

  resetTargetTab(eventType) {
    this.targetTab = {
      ...this.targetTab,
      isScrolling: false,
      isModalOpened: false,
      firedFromEvent: eventType,
    };
    this.setState(State.STOP_OR_CLOSE);
  }

  setTargetTab(props) {
    this.prevTargetTab = { ...this.targetTab };
    this.targetTab = { ...this.targetTab, ...props };
    return this;
  }

  setFocusTab(tab) {
    this.focusTab = { tabId: tab.tabId, windowId: tab.windowId };
    logger.debug(this.focusTab);
    return this.focusTab;
  }

  isWaitingDoubleClick() {
    return this.doubleClickTimer.isWaiting;
  }

  setDoubleClickTimer(tab) {
    this.doubleClickTimer.timerId = setTimeout(() => {
      this.clearDoubleClickTimer();
      this.onSingleClickEvent();
    }, this.doubleClickTimer.interval);
    this.doubleClickTimer.isWaiting = true;
    return this;
  }

  clearDoubleClickTimer() {
    clearTimeout(this.doubleClickTimer.timerId);
    this.doubleClickTimer.isWaiting = false;
    return this;
  }

  setState(newState) {
    const prevState = this.state;
    this.state = newState;
    this.onUpdateState(prevState, newState);
    this.onStateChangeListeners.forEach(func => func(newState));
  }

  addOnStateChangeListener(listener) {
    this.onStateChangeListeners.push(listener.bind(this));
  }

  onUpdateState(prevState, newState) {
    this.updateBrowerAction(newState);
  }

  updateBrowerAction() {
    const getInfo = (currState) => {
      switch (currState) {
        case State.STOP_OR_CLOSE:
          return appBrowseActs.stopOrClose;
        case State.SCROLLING:
        case State.FAST_SCROLLING:
          return appBrowseActs.scrolling;
        case State.MODAL_OPENED:
          return appBrowseActs.modalOpened;
        case State.SLOW_SCROLLING:
        case State.MIDDLE_SCROLLING:
          return appBrowseActs.accelerateScrolling;
        default:
          throw new Error(`Invalid state: ${currState}`);
      }
    };
    const { title, path } = getInfo(this.state);
    return Promise.all([
      setBrowserActionTitle(title),
      setBrowserActionIcon(path),
    ]);
  }

  // begin: event area
  onSingleClickEvent() {
    const eventType = EventType.SINGLE_CLICK;
    switch (this.state) {
      case State.STOP_OR_CLOSE:
        return this.startScrollingAction(eventType);
      case State.MODAL_OPENED:
        if (!this.isEqualTargetToFocus()) break;
        return this.closeModalAction(eventType);
      case State.SCROLLING:
      case State.FAST_SCROLLING:
        if (!this.isEqualTargetToFocus()) break;
        return this.stopScrollingAction(eventType);
      case State.SLOW_SCROLLING:
      case State.MIDDLE_SCROLLING:
        if (!this.isEqualTargetToFocus()) break;
        return this.accelerateScrollingAction(eventType);
      default:
        return Promise.reject(new Error(`Invalid State: ${this.state}`));
    }
    return Promise.resolve();
  }

  onDoubleClickEvent() {
    const eventType = EventType.DOUBLE_CLICK;
    switch (this.state) {
      case State.STOP_OR_CLOSE:
        return this.openModalAction(eventType);
      case State.MODAL_OPENED:
        if (!this.isEqualTargetToFocus()) break;
        return this.closeModalAction(eventType);
      case State.SCROLLING:
      case State.FAST_SCROLLING:
        if (!this.isEqualTargetToFocus()) break;
        return this.stopScrollingAction(eventType);
      case State.SLOW_SCROLLING:
      case State.MIDDLE_SCROLLING:
        if (!this.isEqualTargetToFocus()) break;
        return this.accelerateScrollingAction(eventType);
      default:
        return Promise.reject(new Error(`Invalid State: ${this.state}`));
    }
    return Promise.resolve();
  }

  onActivateChanged(eventType = EventType.TAB_CHANGED) {
    switch (this.state) {
      case State.SCROLLING:
      case State.SLOW_SCROLLING:
      case State.MIDDLE_SCROLLING:
      case State.FAST_SCROLLING:
        if (
          this.isStopScrollingOnFocusOut()
          && this.focusTab.windowId === WINDOW_ID_NONE
        ) return this.stopScrollingAction(eventType);
        if (!this.needToStopScrollingOnTabChanged()) break;
        return this.stopScrollingAction(eventType);
      case State.MODAL_OPENED:
        if (!this.needToCloseModalOnTabChanged()) break;
        return this.closeModalAction(eventType);
      case State.STOP_OR_CLOSE:
        if (
          this.isRestoreScrollingFromSwitchBack()
          && eventType === EventType.TAB_CHANGED
          && this.targetTab.firedFromEvent === EventType.TAB_CHANGED
          && this.prevTargetTab.isScrolling === true
          && this.prevTargetTab.tabId === this.focusTab.tabId
        ) return this.startScrollingAction(eventType, this.prevTargetTab.scrollingSpeed);
        break;
      default:
        return Promise.reject(new Error(`Invalid State: ${this.state}`));
    }
    return Promise.resolve();
  }

  onCommandListener(name) {
    switch (name) {
      case appOpts.keybindSingleClick.commandName:
        // this command acts as SINGLE_CLICK
        try {
          this.onSingleClickEvent();
        } catch (e) {
          logger.error(e);
        }
        break;
      default:
        logger.error(new Error(`Undefined command: ${name}`));
        break;
    }
  }

  onRecieveInitContentScript() {
    if (!this.isEqualTargetToFocus()) return;
    this.setTargetTab({
      isScrolling: false,
      isModalOpened: false,
      firedFromEvent: EventType.INIT_CONTENT_SCRIPT,
    });
    this.setState(State.STOP_OR_CLOSE);
  }

  onReceiveStopMessage() {
    this.setTargetTab({
      tabId: TAB_ID_NONE,
      windowId: WINDOW_ID_NONE,
      isScrolling: false,
      firedFromEvent: EventType.CONTENT_SCRIPT_MESSAGE,
    });
    this.setState(State.STOP_OR_CLOSE);
  }

  onReceiveCloseMessage() {
    this.setTargetTab({
      tabId: TAB_ID_NONE,
      windowId: WINDOW_ID_NONE,
      isModalOpened: false,
      firedFromEvent: EventType.CONTENT_SCRIPT_MESSAGE,
    });
    this.setState(State.STOP_OR_CLOSE);
  }
  // end: event area

  needToStopScrollingOnTabChanged() {
    return (
      this.targetTab.isScrolling
      && this.targetTab.tabId !== this.focusTab.tabId
      && this.targetTab.windowId === this.focusTab.windowId
    );
  }

  needToCloseModalOnTabChanged() {
    return (
      this.targetTab.isModalOpened
      && this.targetTab.tabId !== this.focusTab.tabId
      && this.targetTab.windowId === this.focusTab.windowId
    );
  }

  isEqualTargetToFocus() {
    return this.targetTab.tabId === this.focusTab.tabId;
  }

  getScrollingSpeed(state) {
    switch (state) {
      case State.SCROLLING:
        return this.options.scrollingSpeed.value;
      case State.SLOW_SCROLLING:
        return this.options.transmissionGearOfSlow.value;
      case State.MIDDLE_SCROLLING:
        return this.options.transmissionGearOfMiddle.value;
      case State.FAST_SCROLLING:
        return this.options.transmissionGearOfFast.value;
      default:
        throw new Error('Invalid state');
    }
  }

  getNextScrollingState() {
    if (!this.isEnabledTransmissionScrolling()) {
      throw new Error('Invalid call');
    }
    const get = () => {
      switch (this.state) {
        case State.SLOW_SCROLLING:
          return State.MIDDLE_SCROLLING;
        case State.MIDDLE_SCROLLING:
          return State.FAST_SCROLLING;
        default:
          throw new Error('Invalid state');
      }
    };
    return get();
  }

  // begin: action area
  startScrollingAction(eventType, startState = null) {
    let scrollingState;
    if (this.isEnabledTransmissionScrolling()) {
      scrollingState = startState || State.SLOW_SCROLLING;
    } else {
      scrollingState = State.SCROLLING;
    }

    return isNotSystemTabWith(this.focusTab.tabId)
      .then(() => sendMessageToTab(this.focusTab.tabId,
        addDataToMessage(MESSAGE_START_SCROLLING, {
          scrollingSpeed: this.getScrollingSpeed(scrollingState),
        })))
      .then(() => {
        this.setTargetTab({
          tabId: this.focusTab.tabId,
          windowId: this.focusTab.windowId,
          isScrolling: true,
          scrollingSpeed: scrollingState,
          firedFromEvent: eventType,
        });
        this.setState(scrollingState);
      });
  }

  stopScrollingAction(eventType) {
    return isNotSystemTabWith(this.targetTab.tabId)
      .then(() => sendMessageToTab(this.targetTab.tabId, MESSAGE_STOP_SCROLLING))
      .then(() => {
        this.setTargetTab({
          tabId: TAB_ID_NONE,
          windowId: WINDOW_ID_NONE,
          isScrolling: false,
          scrollingSpeed: null,
          firedFromEvent: eventType,
        });
        this.setState(State.STOP_OR_CLOSE);
      });
  }

  accelerateScrollingAction(eventType) {
    const state = this.getNextScrollingState();

    return isNotSystemTabWith(this.targetTab.tabId)
      .then(() => sendMessageToTab(this.targetTab.tabId,
        addDataToMessage(MESSAGE_CHANGE_SPEED, {
          scrollingSpeed: this.getScrollingSpeed(state),
        })))
      .then(() => {
        this.targetTab = { ...this.targetTab, scrollingSpeed: state };
        this.setState(state);
      });
  }

  openModalAction(eventType) {
    return isNotSystemTabWith(this.focusTab.tabId)
      .then(() => sendMessageToTab(this.focusTab.tabId, MESSAGE_OPEN_MODAL))
      .then(() => {
        this.setTargetTab({
          tabId: this.focusTab.tabId,
          windowId: this.focusTab.windowId,
          isModalOpened: true,
          firedFromEvent: eventType,
        });
        this.setState(State.MODAL_OPENED);
      });
  }

  closeModalAction(eventType) {
    return isNotSystemTabWith(this.targetTab.tabId)
      .then(() => sendMessageToTab(this.targetTab.tabId, MESSAGE_CLOSE_MODAL))
      .then(() => {
        this.setTargetTab({
          tabId: TAB_ID_NONE,
          windowId: WINDOW_ID_NONE,
          isModalOpened: false,
          firedFromEvent: eventType,
        });
        this.setState(State.STOP_OR_CLOSE);
      });
  }
  // end: action area
}

const backgroundScript = new BackgroundScript();
backgroundScript.init();
const contextMenuScript = new ContextMenuScript(backgroundScript);
contextMenuScript.init();
backgroundScript.addOnStateChangeListener(contextMenuScript.onStateChange);
