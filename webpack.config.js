
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const ExtractTextPlugin = require('extract-text-webpack-plugin');

const src = path.resolve(__dirname, 'src');
const dist = path.resolve(__dirname, 'dist');

module.exports = {
  entry: {
    content: path.join(src, 'content'),
    background: path.join(src, 'background'),
    options: path.join(src, 'options')
  },

  output: {
    path: dist,
    filename: '[name].js'
  },

  module: {
    loaders: [
      {
        test: /\.js/,
        exclude: /node_modules/,
        loader: 'babel-loader',
        query: {
          presets: [ 'es2015' ]
        }
      }
    ],
    rules: [
      {
        test: /\.css$/,
        use: ExtractTextPlugin.extract({
          fallback: 'style-loader',
          use: 'css-loader'
        })
      }
    ]
  },

  resolve: {
    extensions: [ '.js' ]
  },

  plugins: [
    new HtmlWebpackPlugin({
      filename: 'options.html',
      template: path.join(src, '/options/index.html'),
      inject: false
    }),
    new ExtractTextPlugin('index.css')
  ]

};


