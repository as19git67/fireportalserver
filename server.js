#!/usr/bin/env node

/**
 * Module dependencies.
 */

const app = require('./app');
const config = require('./config');
const debug = require('debug')('fireportal:server');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

let server;
let port;

function _startWebSockets() {
  const wss = new WebSocket.Server({server});
  app.set('wss', wss);
  wss.on('connection', function connection(ws) {
    ws.on('message', function incoming(message) {
      console.log('received websocket messaage: %s', message);
    });
  });
}

app.doInitialConfig().then(function () {
  port = config.get('httpsPort');

  if (port) {
    app.set('port', port);
    try {
      const secureOptions = {
        key: fs.readFileSync(path.resolve(__dirname, 'key.pem')),
        cert: fs.readFileSync(path.resolve(__dirname, 'cert.pem'))
      };
      // Create HTTPS server
      server = https.createServer(secureOptions, app);
      _startWebSockets();

      // Listen on provided port, on all network interfaces.
      server.listen(port, function () {
        console.log(app.get('appName') + ' https server listening on port ' + port);
      });
      server.on('error', onError);
      server.on('listening', onListening);
    } catch (e) {
      console.log("EXCEPTION while creating the https server:", e);
    }
  } else {
    // no https -> try http
    port = process.env.PORT || config.get('httpPort');
    //const httpPort = normalizePort(process.env.PORT || '3000');
    if (port) {
      app.set('port', port);
      // Create HTTP server
      server = http.createServer(app);
      _startWebSockets();

      // Listen on provided port, on all network interfaces.
      server.listen(port, function () {
        console.log(app.get('appName') + ' http server listening on port ' + port);
      });
      server.on('error', onError);
      server.on('listening', onListening);
    }
  }

}).catch(reason => {
  console.log(reason);
  console.log("Not starting web-server, because initial configuration failed.");
});

/**
 * Normalize a port into a number, string, or false.
 */

function normalizePort(val) {
  let port = parseInt(val, 10);

  if (isNaN(port)) {
    // named pipe
    return val;
  }

  if (port >= 0) {
    // port number
    return port;
  }

  return false;
}

/**
 * Event listener for HTTP server "error" event.
 */

function onError(error) {
  if (error.syscall !== 'listen') {
    throw error;
  }

  let bind = typeof port === 'string'
             ? 'Pipe ' + port
             : 'Port ' + port;

  // handle specific listen errors with friendly messages
  switch (error.code) {
  case 'EACCES':
    console.error(bind + ' requires elevated privileges');
    process.exit(1);
    break;
  case 'EADDRINUSE':
    console.error(bind + ' is already in use');
    process.exit(1);
    break;
  default:
    throw error;
  }
}

/**
 * Event listener for HTTP server "listening" event.
 */

function onListening() {
  const addr = server.address();
  let bind = typeof addr === 'string'
             ? 'pipe ' + addr
             : 'port ' + addr.port;
  debug('Listening on ' + bind);
}
