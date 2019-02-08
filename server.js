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

function _startWebSockets(server) {
  const wss = new WebSocket.Server({server});
  app.set('wss', wss);
  wss.on('connection', function connection(ws) {
    ws.on('message', function incoming(message) {
      console.log('received websocket messaage: %s', message);
    });
  });
}

app.doInitialConfig().then(function () {
  let port = config.get('httpsPort');
  let certPath = config.get('certPath');
  if (!certPath) {
    certPath = __dirname;
  }

  if (port) {
    app.set('httpsPort', port);
    try {
      const secureOptions = {
        key: fs.readFileSync(path.resolve(certPath, 'key.pem')),
        cert: fs.readFileSync(path.resolve(certPath, 'cert.pem'))
      };
      // Create HTTPS server
      let httpsServer = https.createServer(secureOptions, app);
      _startWebSockets(httpsServer);

      // Listen on provided port, on all network interfaces.
      httpsServer.listen(port, function () {
        console.log(app.get('appName') + ' https server listening on port ' + port);
      });
      httpsServer.on('error', onError);
      httpsServer.on('listening', function () {
        onListening(httpsServer)
      });
    } catch (e) {
      console.log("EXCEPTION while creating the https server:", e);
    }
  }
  port = config.get('httpPort');
  //const httpPort = normalizePort(process.env.PORT || '3000');
  if (port) {
    app.set('httpPort', port);
    // Create HTTP server
    let httpServer = http.createServer(app);
    _startWebSockets(httpServer);

    // Listen on provided port, on all network interfaces.
    httpServer.listen(port, function () {
      console.log(app.get('appName') + ' http server listening on port ' + port);
    });
    httpServer.on('error', onError);
    httpServer.on('listening', function () {
      onListening(httpServer)
    });
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

function onListening(server) {
  const addr = server.address();
  let bind = typeof addr === 'string'
             ? 'pipe ' + addr
             : 'port ' + addr.port;
  debug('Listening on ' + bind);
}
