const path = require('path');

module.exports = {
  entry: {
    xstreamingPlayer: './src/index.ts',
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  output: {
    filename: '[name].min.js',
    path: path.resolve(__dirname, 'dist/assets'),
    // libraryTarget: 'var',
    library: '[name]'
  },
  experiments: {
    asyncWebAssembly: true,
  }
};