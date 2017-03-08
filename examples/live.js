'use strict';

const hlss = require('../index.js');

const args = process.argv;

if (args.length !== 3) {
  console.log('Usage:\n\
  ffmpeg -re -i source.mp4 -c copy -bsf h264_mp4toannexb\
 -f mpegts - | node live.js out_path');
  process.exit(1);
}

const stream = process.stdin;

const segmenter = new hlss({
  outPath: args[2],
  streamName: 'test',
  segDuration: 5,
  segNumber: 4,
  deleteFiles: true
});

segmenter.on('done', () => {
  console.log('all done!');
});

segmenter.start(stream);
