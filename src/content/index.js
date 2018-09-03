'use strict';

import { onError } from '../utils';
import './index.css';

const getScrollingElement = () => {
  return document.scrollingElement
    ? document.scrollingElement
    : document.documentElement;
};

const defaultValues = {
  intervalID: -1,
  x: 0,
  y: 0,
  scrollingElement: null,
  currentlyHovering: false,
  scrollingStep: 1,
  scrollingSpeed: 50,
  stopScrollingByClick: true,
  stopScrollingOnHover: false
};

let autoScrolling = Object.assign({}, defaultValues, {
  scrollingAction: function() {
    if (this.stopScrollingOnHover && this.currentlyHovering) {
      return;
    }
    this.y = this.y + this.scrollingStep;
    this.scrollingElement.scroll(this.x, this.y);
  },
  start: function() {
    this.scrollingElement = getScrollingElement();
    unregisterBodyMouseEvents();
    registerBodyMouseEvents();
    this.intervalID = window.setInterval(
      this.scrollingAction.bind(this),
      100 - this.scrollingSpeed
    );
  },
  stop: function() {
    unregisterBodyMouseEvents();
    window.clearInterval(this.intervalID);
  }
});

// Deconstruct only the fields which are synchronized.
const updateFromSync = () => {
  const {
    scrollingStep,
    scrollingSpeed,
    stopScrollingByClick,
    stopScrollingOnHover
  } = defaultValues;

  browser.storage.sync
    .get({
      scrollingStep,
      scrollingSpeed,
      stopScrollingByClick,
      stopScrollingOnHover
    })
    .then(data => {
      Object.assign(autoScrolling, data);
    })
    .catch(onError);
};

updateFromSync();

// DOM Events
const mouseoverEvents = (ev) => {
  const target = ev.target;
  if (autoScrolling.stopScrollingOnHover) {
    if (target == document.body) {
      autoScrolling.currentlyHovering = false;
    } else {
      let targetRect = target.getBoundingClientRect();
      // console.log(ev, targetRect, (targetRect.right > ev.pageX || targetRect.top > ev.pageY));
      // Check if the mouse is overlapping with the resulting element's dimensions.
      if (
        targetRect.width != document.body.clientWidth 
        && (targetRect.right > ev.pageX || targetRect.top > ev.pageY)
      ) {
        autoScrolling.currentlyHovering = true;
      } else {
        autoScrolling.currentlyHovering = false;
      }
    }
  }
};

const mouseoutEvents = () => {
  autoScrolling.currentlyHovering = false;
};

const clickEvents = () => {
  if (autoScrolling.stopScrollingByClick == true) {
    browser.runtime
      .sendMessage({
        isScrolling: false
      })
      .then(() => {
        autoScrolling.stop();
      })
      .catch(onError);
  }
};

const registerBodyMouseEvents = () => {
  document.body.addEventListener('mouseover', mouseoverEvents);
  document.body.addEventListener('mouseout', mouseoutEvents);
  document.body.addEventListener('click', clickEvents);
};

const unregisterBodyMouseEvents = () => {
  document.body.removeEventListener('mouseover', mouseoverEvents);
  document.body.removeEventListener('mouseout', mouseoutEvents);
  document.body.removeEventListener('click', clickEvents);
};

// WebExtensions Events
browser.runtime.onMessage.addListener(msg => {
  if (msg.isScrolling) {
    autoScrolling.x = window.scrollX;
    autoScrolling.y = window.scrollY;
    autoScrolling.scrollingElement = getScrollingElement();
    autoScrolling.start();
  } else {
    autoScrolling.stop();
  }

  if (msg.isOpenOverlay) {
    openOverlay();
  }
});

browser.storage.onChanged.addListener(changes => {
  var changedItems = Object.keys(changes);
  for (var item of changedItems) {
    if (item == 'scrollingSpeed') {
      autoScrolling.scrollingSpeed = parseInt(changes[item]['newValue']);
    }
    if (item == 'stopScrollingByClick') {
      autoScrolling.stopScrollingByClick = changes[item]['newValue'];
    }
  }
});

// Autoscrolling Overlay
const openOverlay = () => {
  let overlayEle = document.getElementById('auto-scrolling-overlay');
  overlayEle.classList = ['auto-scrolling-overlay is-open'];
};

const closeOverlay = () => {
  let overlayEle = document.getElementById('auto-scrolling-overlay');
  overlayEle.classList = ['auto-scrolling-overlay'];
};

const setScrollingSpeed = ev => {
  let scrollingSpeed = ev.target.value;
  if (scrollingSpeed > 100) {
    scrollingSpeed = 99;
  } else if (scrollingSpeed < 0) {
    scrollingSpeed = 1;
  }
  autoScrolling.scrollingSpeed = scrollingSpeed;
  browser.storage.sync.set({ scrollingSpeed: scrollingSpeed });
};

const setStopScrollingByClick = ev => {
  let stopScrollingByClick = ev.target.checked;
  autoScrolling.stopScrollingByClick = stopScrollingByClick;
  browser.storage.sync.set({ stopScrollingByClick: stopScrollingByClick });
};

const insertOverlayElement = () => {
  let overlayEle = document.createElement('div');
  overlayEle.id = 'auto-scrolling-overlay';
  overlayEle.classList = ['auto-scrolling-overlay'];
  overlayEle.innerHTML = require('html-loader!./index.html');
  overlayEle.addEventListener('click', () => {
    browser.runtime
      .sendMessage({
        isOpenOverlay: false
      })
      .then(() => {
        closeOverlay();
      })
      .catch(onError);
  });
  document.body.appendChild(overlayEle);

  let overlayWrapperEle = document.getElementById(
    'auto-scrolling-overlay-wrapper'
  );
  overlayWrapperEle.addEventListener('click', ev => {
    ev.stopPropagation();
  });
};

const setupOverlayWindow = () => {
  insertOverlayElement();

  const scrollingSpeedEl = document.getElementById(
    'auto-scrolling-overlay-scrolling-speed'
  );
  const stopScrollingByClickEl = document.getElementById(
    'auto-scrolling-overlay-stop-scrolling-by-click'
  );

  scrollingSpeedEl.addEventListener('change', setScrollingSpeed);
  stopScrollingByClickEl.addEventListener('change', setStopScrollingByClick);
};

setupOverlayWindow();
