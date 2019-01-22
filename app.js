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

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({extended: false}));
app.use(cookieParser());
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
