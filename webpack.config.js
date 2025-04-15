const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  mode: 'production', // 'development' for debugging, 'production' for deployment
  entry: {
    background: './ts/background.ts',
    content: './ts/content.ts',
    popup: './ts/popup.ts',
    // Add other scripts like offscreen.js if they also use imports
  },
  output: {
    path: path.resolve(__dirname, 'dist/js'),
    filename: '[name].js',
    clean: true, // Clean the output directory before each build
  },
  module: {
    rules: [
      {
        test: /\.[jt]s$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            // Babel config is now in babel.config.js
            // presets: ['@babel/preset-env', '@babel/preset-typescript'] 
          }
        }
      }
    ]
  },
  // Optional: Add source maps for easier debugging in development mode
  // devtool: process.env.NODE_ENV === 'development' ? 'cheap-module-source-map' : false,
  resolve: {
    // Add .ts to the list of extensions Webpack will resolve
    extensions: ['.ts', '.js'],
  },
  // Important for WebAssembly used by WebLLM
  experiments: {
    asyncWebAssembly: true,
    syncWebAssembly: true, // Depending on WebLLM needs, sync might be necessary
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        // Copy manifest.json to the root of the dist folder
        { from: 'manifest.json', to: path.resolve(__dirname, 'dist') }, 
        // Copy popup.html to the root of the dist folder
        { from: 'popup.html', to: path.resolve(__dirname, 'dist') }, 
         // Copy premium.html if it exists
        { from: 'premium.html', to: path.resolve(__dirname, 'dist'), noErrorOnMissing: true }, 
        // Copy css folder to dist/css
        { from: 'css', to: path.resolve(__dirname, 'dist/css') }, 
        // Copy icons folder to dist/icons
        { from: 'icons', to: path.resolve(__dirname, 'dist/icons') }, 
        // Copy locales folder if it exists
        { from: '_locales', to: path.resolve(__dirname, 'dist/_locales'), noErrorOnMissing: true }, 
      ],
    }),
  ],
}; 