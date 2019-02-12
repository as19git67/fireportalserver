const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const _ = require('underscore');
const config = require('./config');
const moment = require('moment');

const apiRouter = require('./routes/api');

var app = express();

app.set('appName', 'Firealarm Portal Server');

// view engine setup
// app.set('views', path.join(__dirname, 'views'));
// app.set('view engine', 'hbs');

const passport = require('passport');
const passportStrategies = require('./passport-strategies');

app.use(logger('short'));
app.use(express.json());
app.use(express.urlencoded({extended: false}));
app.use(cookieParser());
//app.use('/assets', express.static(path.join(__dirname, 'assets')));  // serve static files with assets
app.use(express.static(path.join(__dirname, 'certbot')));  // serve static files for let's encrypt

app.use(function (req, res, next) {
  // disallow all php requests
  if (req.url.endsWith('.php')) {
    res.status(403).end();
    return;
  }
  // some other request no abort
  if (!req.headers || !req.headers.host) {
    res.status(403).end();
    return;
  }

  if (req.url.endsWith('manager/html')) {
    res.status(403).end();
    return;
  }

  if (req.secure || process.env.NODE_ENV === 'development') {
    // request was via https or server runs in a dev environment ->no special handling
    // if (req.secure) {
    //   console.log("Request is already https - next()");
    // }
    // console.log("Running in " + process.env.NODE_ENV + " mode. Allow " + req.protocol + '://' + req.get('host') + req.url);
    next();
  } else {
    // request was via http, so redirect to https
    const secUrl = 'https://' + req.headers.host + req.url;
    console.log("Redirecting " + req.protocol + '://' + req.get('host') + req.url + " to https: " + secUrl);
    res.redirect(secUrl);
  }
});

app.use(express.static(path.join(__dirname, 'dist')));  // serve vue client app

app.use('/api', apiRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  //res.json({status: err.status || 500, message: err.message});
  res.status(err.status || 500).json({error: err.message});
});

app.doInitialConfig = function () {
  return new Promise((resolve, reject) => {
    moment.locale('de');
    resolve();
  });
};

passportStrategies.init(passport);

module.exports = app;
