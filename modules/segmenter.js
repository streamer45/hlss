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
    this.deleteFiles = setup.deleteFiles === false ? false : true;
    this._init();
  }

  _init() {
    this._pat = null;
    this._pmt = null;
    this._segments = [];
    this._segCounter = 0;
    this._lastSegPTS = 0;
    this._packetStream = new ts.TransportPacketStream();
    this._parseStream = new ts.TransportParseStream();
    this._inStream = null;
    this._outStream = null;
    this._first = true;
  }

  _genPlaylist() {
    let playlist = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-ALLOW-CACHE:NO\n';
    const maxDuration = Math.round(Math.max(...this._segments));
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
    let ptsDiff = 0;
    const packet = result.packet;
    if (result.type === 'pat') {
      if (this._pat) return;
      this._pat = Buffer.from(packet);
      return;
    }
    if (result.type === 'pmt') {
      if (this._pmt) return;
      this._pmt = Buffer.from(packet);
      return;
    }
    if (result.type === 'pes' && result.streamType === 27) {
      result.keyframe = probe.videoPacketContainsKeyFrame(packet);
    }
    if (result.payloadUnitStartIndicator && result.streamType === 27) {
      const res = probe.parsePesTime(packet);
      if (res && res.pts) res.pts /= PES_TIME_SCALE;
      if (res && res.dts) res.dts /= PES_TIME_SCALE;
      if (res && res.pts) {
        if (this._lastSegPTS === 0) this._lastSegPTS = res.pts;
        ptsDiff = res.pts - this._lastSegPTS;
        if (ptsDiff < 0) {
          this._lastSegPTS = 0;
          ptsDiff = 0;
        }
      }
      if (result.keyframe && Math.round(ptsDiff) >= this.segDuration) {
        this._segments.push(ptsDiff.toFixed(6));
        if (this._segments.length > this.segNumber) {
          this._segments.shift();
          ++this._segCounter;
        }
        this._outStream.end();
        this._genPlaylist();
        this._lastSegPTS = res.pts;
        const outName = this.outPath + '/' + this.streamName +
        (this._segCounter + this._segments.length) + '.ts';
        this._outStream = fs.createWriteStream(outName);
        if (this._pat && this._pmt) {
          this._outStream.write(this._pat);
          this._outStream.write(this._pmt);
          const cc = (this._pat[3] & 0x0f) + 1;
          this._pat[3] &= ~0xf;
          this._pmt[3] &= ~0xf;
          this._pat[3] |= (cc & 0xf);
          this._pmt[3] |= (cc & 0xf);
        }
        if (this.deleteFiles === true) {
          const delNo = this._segCounter - (this.segNumber * 2);
          if (delNo >= 0) {
            const delName = this.outPath + '/' +
             this.streamName + delNo + '.ts';
            fs.unlink(delName, (err) => {
              if (err) this.emit('error', err);
            });
          }
        }
      }
    }
    if (this._first) {
      if (this._pat && this._pmt) {
        this._outStream.write(this._pat);
        this._outStream.write(this._pmt);
        const cc = (this._pat[3] & 0x0f) + 1;
        this._pat[3] &= ~0xf;
        this._pmt[3] &= ~0xf;
        this._pat[3] |= (cc & 0xf);
        this._pmt[3] |= (cc & 0xf);
      }
      this._first = false;
    }
    this._outStream.write(Buffer.from(packet));
  }

  start(inStream) {
    if (this._inStream) return;
    this._inStream = inStream;
    const outName = this.outPath + '/' + this.streamName +
    (this._segCounter + this._segments.length) + '.ts';
    this._outStream = fs.createWriteStream(outName);
    this._inStream.on('data', this._pipe.bind(this));
    this._inStream.on('end', () => {
      this.flush();
    });
    this._packetStream.on('done', () => {
      this._parseStream.flush();
    });
    this._parseStream.on('done', () => {
      this.emit('done');
    });
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
    if (this.deleteFiles === true) {
      let delNo;
      delNo = this._segCounter - (this.segNumber * 2) + 1;
      if (delNo < 0) delNo = 0;
      try {
        fs.unlinkSync(this.outPath + '/' + this.streamName + '.m3u8');
      } catch (e) {}
      for (let i = delNo; i <= this._segCounter + this._segments.length; ++i) {
        const delName = this.outPath + '/' + this.streamName + i + '.ts';
        try {
          fs.unlinkSync(delName);
        } catch (e) {}
      }
    }
    if (this._outStream) this._outStream.destroy();
    this._init();
  }

  flush() {
    this._packetStream.flush();
  }
}

module.exports = Segmenter;
