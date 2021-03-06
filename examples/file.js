'use strict';

const fs = require('fs');
const hlss = require('../index.js');

const args = process.argv;

if (args.length !== 4) {
  console.log('Usage:\n\
  node file.js input_file out_path');
  process.exit(1);
}

const stream = fs.createReadStream(args[2]);

const segmenter = new hlss({
  outPath: args[3],
  streamName: 'test',
  segDuration: 5,
  segNumber: 4,
  deleteFiles: true
});

segmenter.on('done', () => {
  console.log('all done!');
});

segmenter.start(stream);
