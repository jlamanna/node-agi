var Readable = require('readable-stream');
var EventEmitter = require('events').EventEmitter;
var state = require('./state');

var Context = function(stream) {
  EventEmitter.call(this);
  this.stream = new Readable();
  this.stream.wrap(stream);
  this.state = state.init;
  this.answered = false;
  this.msg = "";
  var self = this;
  this.stream.on('readable', function() {
    //always keep the 'leftover' part of the message
    self.msg = self.read();
  });
  this.msg = this.read();
  this.variables = {};
  this.pending = null;
  this.pendingCmd = '';
  this.stream.on('error', this.emit.bind(this, 'error'));
  this.stream.on('close', this.emit.bind(this, 'close'));
};

require('util').inherits(Context, EventEmitter);

Context.prototype.read = function() {
  var buffer = this.stream.read();
  if(!buffer) return this.msg;
  this.msg += buffer.toString('utf8');
  if(this.state === state.init) {
    if(this.msg.indexOf('\n\n') < 0) return this.msg; //we don't have whole message
    this.readVariables(this.msg);
  } else if(this.state === state.waiting) {
    if(this.msg.indexOf('\n') < 0) return this.msg; //we don't have whole message
    this.readResponse(this.msg);
  }
  return "";
};

Context.prototype.readVariables = function(msg) {
  var lines = msg.split('\n');
  for(var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var split = line.split(':')
    var name = split[0];
    var value = split[1];
    this.variables[name] = (value||'').trim();
  }
  this.emit('variables', this.variables);
  this.setState(state.waiting);
  return "";
};

Context.prototype.readResponse = function(msg) {
  var lines = msg.split('\n');
  for(var i = 0; i < lines.length; i++) {
    this.readResponseLine(lines[i]);
  }
  return "";
};

Context.prototype.readResponseLine = function(line) {
  if(!line) return;
  var parsed = /^(\d{3})(?: result=)([^(]*)(?:\((.*)\))?/.exec(line);
  if(!parsed) {
    return this.emit('hangup');
  }
  var response = {
    code: parseInt(parsed[1]),
    result: parsed[2].trim(),
    timeout: false,
    digits: '',
    value: null
  };

  if (parsed.length == 4) {
    response.value = parsed[3];
    if (parsed[3] == 'timeout') {
      response.timeout = true;
    }
  }

  // Normalize get data vs wait for digit
  if (this.pendingCmd.indexOf('WAIT FOR DIGIT') != -1) {
    if (response.result == '0') {
      response.timeout = true;
      response.digits = '';
    } else if (response.result != '-1') {
      response.digits = String.fromCharCode(parseInt(response.result, 10));
    }
  } else if (this.pendingCmd.indexOf('GET DATA') != -1) {
    if (response.result == '' && !response.timeout) {
      // # pressed
      response.digits = '#';
    } else {
      response.digits = response.result;
    }
  }

  //our last command had a pending callback
  if(this.pending) {
    var pending = this.pending;
    this.pending = null;
    pending(null, response);
  }
  this.emit('response', response);
}

Context.prototype.setState = function(state) {
  this.state = state;
};

Context.prototype.send = function(msg, cb) {
  this.pending = cb;
  this.pendingCmd = msg;
  this.stream.write(msg);
};

Context.prototype.exec = function() {
  var args = Array.prototype.slice.call(arguments, 0);
  var last = args.pop();
  if(typeof last !== 'function') {
    args.push(last);
    last = function() { }
  }
  this.send('EXEC ' + args.join(' ') + '\n', last);
};

Context.prototype.getVariable = function(name, cb) {
  this.send('GET VARIABLE ' + name + '\n', cb || function() { });
};

Context.prototype.answer = function(cb) {
  if (!this.answered) {
    this.answered = true;
    this.send('ANSWER\n', cb);
  } else {
    cb(null, null);
  }
};

Context.prototype.streamFile = function(filename, acceptDigits, cb) {
  if(typeof acceptDigits === 'function') {
    cb = acceptDigits;
    acceptDigits = "1234567890#*";
  }
  this.send('STREAM FILE "' + filename + '" "' + acceptDigits + '"\n', cb);
};

Context.prototype.waitForDigit = function(timeout, cb) {
  if(typeof timeout === 'function') {
    cb = timeout;
    //default to 2 second timeout
    timeout = 5000;
  }
  this.send('WAIT FOR DIGIT ' + timeout + '\n', cb);
};

Context.prototype.getData = function(filename, timeout, maxDigits, cb) {
  if (typeof timeout === 'function') {
    cb = timeout;
    timeout = '';
    maxDigits = '';
  }
  if (typeof maxDigits === 'function') {
    cb = maxDigits;
    maxDigits = '';
  }

  this.send('GET DATA ' + filename + ' ' + timeout + ' ' + maxDigits + '\n', cb);
};

Context.prototype.setVariable = function(name, val, cb)
{
  this.send('SET VARIABLE ' + name + ' "' + val + '"\n', cb);
};

Context.prototype.dbGet = function(family, key, cb)
{
  this.send('DATABASE GET ' + family + ' ' + key + '\n', cb);
};

Context.prototype.dbPut = function(family, key, val, cb)
{
  this.send('DATABASE PUT ' + family + ' ' + key + ' ' + val + '\n', cb);
};

Context.prototype.dbDel = function(family, key, cb)
{
  this.send('DATABASE DEL ' + family + ' ' + key + '\n', cb);
};

Context.prototype.setCallerId = function(name, number, cb) {
  var callerId = '"' + name + '"<' + number + '>';

  this.send('SET CALLERID ' + callerId + '\n', cb);
};

Context.prototype.verbose = function(msg, priority, cb) {
  if (typeof priority === 'function') {
    cb = priority;
    priority = '';
  }

  this.send('VERBOSE "' + msg + '" ' + priority);
}

Context.prototype.hangup = function(cb) {
  this.send('HANGUP\n', cb);
};

Context.prototype.end = function() {
  this.stream.end();
};

module.exports = Context;

// vim: ts=2:sw=2:et
