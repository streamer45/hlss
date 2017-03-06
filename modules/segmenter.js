'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const ts = require('./mux.js/m2ts');
const probe = require('./mux.js/probe');

const PES_TIME_SCALE = 90000;

class Segmenter extends EventEmitter {
  constructor(setup) {
    super();
    this.outPath = setup.outPath;
    this.streamName = setup.streamName || 'stream';
    this.segDuration = setup.segDuration || 4;
    this.segNumber = setup.segNumber || 6;
    this._init();
  }

  _init() {
    this._pat = null;
    this._pmt = null;
    this._segments = [];
    this._segCounter = 0;
    this._lastPTS = 0;
    this._lastSegPTS = 0;
    this._packetStream = new ts.TransportPacketStream();
    this._parseStream = new ts.TransportParseStream();
    this._inStream = null;
    this._outStream = null;
  }

  _genPlaylist() {
    let playlist = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-ALLOW-CACHE:NO\n';
    const maxDuration = Math.ceil(Math.max(...this._segments));
    playlist += `#EXT-X-TARGETDURATION:${maxDuration}\n`;
    playlist += `#EXT-X-MEDIA-SEQUENCE:${this._segCounter}\n`;
    for (let i = 0; i < this._segments.length; ++i) {
      playlist += `#EXTINF:${this._segments[i]},\n`;
      playlist += this.streamName + (this._segCounter + i) + '.ts\n';
    }
    const name = this.outPath + '/' + this.streamName + '.m3u8';
    const tempName = this.outPath + '/' + '.tmp.m3u8';
    fs.writeFileSync(tempName, playlist);
    fs.renameSync(tempName, name);
  }

  _pipe(chunk) {
    this._packetStream.push(chunk);
  }

  _process(result) {
    const packet = result.packet;
    if (result.type === 'pat') this._pat = Buffer.from(packet);
    if (result.type === 'pmt') this._pmt = Buffer.from(packet);
    if (result.type === 'pes' && result.streamType === 27) {
      result.keyframe = probe.videoPacketContainsKeyFrame(packet);
    }
    if (result.payloadUnitStartIndicator) {
      const res = probe.parsePesTime(packet);
      if (res && res.pts) res.pts /= PES_TIME_SCALE;
      if (res && res.dts) res.dts /= PES_TIME_SCALE;
      if (res && res.pts) {
        this._lastPTS = res.pts;
        if (this._lastSegPTS === 0) this._lastSegPTS = this._lastPTS;
      }
      if (result.keyframe &&
         (this._lastPTS - this._lastSegPTS) >= this.segDuration) {
        //console.log('need to split!', this._lastPTS - this._lastSegPTS);
        this._segments.push((this._lastPTS - this._lastSegPTS).toFixed(6));
        if (this._segments.length === this.segNumber) {
          this._segments.shift();
          ++this._segCounter;
        }
        this._outStream.end();
        this._genPlaylist();
        this._lastSegPTS = this._lastPTS;
        const outName = this.outPath + '/' + this.streamName +
        (this._segCounter + this._segments.length) + '.ts';
        this._outStream = fs.createWriteStream(outName);
        if (this.pat && this.pmt) {
          this._outStream.write(this._pat);
          this._outStream.write(this._pmt);
        }
      }
    }
    this._outStream.write(Buffer.from(packet));
  }

  start(inStream) {
    if (this._inStream) return;
    this._inStream = inStream;
    const outName = this.outPath + '/' + this.streamName +
    (this._segCounter + this._segments.length) + '.ts';
    this._outStream = fs.createWriteStream(outName);
    //this._packetStream.pipe(this._parseStream);
    this._inStream.on('data', this._pipe.bind(this));
    this._packetStream.on('data', (packet) => {
      this._parseStream.push(packet);
    });
    this._parseStream.on('data', this._process.bind(this));
  }

  stop() {
    if (!this._inStream) return;
    this._inStream.removeListener('data', this._pipe);
    this._packetStream.dispose();
    this._parseStream.dispose();
    this._init();
  }

  flush() {
    this._packetStream.flush();
    this._packetStream.on('done', () => {
      this._parseStream.flush();
      this._parseStream.on('done', () => {
        this.emit('done');
      });
    });
  }
}

module.exports = Segmenter;
