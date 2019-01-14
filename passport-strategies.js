const _ = require('underscore');
const moment = require('moment');
const BearerStrategy = require('passport-http-bearer').Strategy;
const config = require('./config');

module.exports.init = function (passport, callback) {

  passport.use(new BearerStrategy(function (accessToken, done) {
        // console.log('Bearer Strategy with token ' + accessToken);
        // console.log('BEARER Strategy');

        const bearers = config.get('bearerTokens');
        const username = bearers[accessToken];
        if (username) {
          const info = {scope: '*'};
          const user = {name: username};
          done(null, user, info);
        } else {
          return done({message: 'invalid bearer token', status: 401});
        }

      }
  ));

  if (_.isFunction(callback)) {
    callback(null);
  }
};

// Simple route middleware to ensure user is authenticated.
//   Use this route middleware on any resource that needs to be protected.  If
//   the request is authenticated (typically via a persistent login session),
//   the request will proceed.  Otherwise, the user will be redirected to the
//   login page.
let ensureAuthenticated = function (req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  const nextUrl = req.route.path;
  if (nextUrl && nextUrl != '/') {
    res.redirect('/login?nexturl=' + nextUrl);
  } else {
    res.redirect('/login');
  }
  return null;
};

module.exports.ensureAuthenticated = ensureAuthenticated;

module.exports.ensureAuthenticatedForApi = function (req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.statusCode = 401;
  res.json({error: '401 Unauthorized'});
  return null;
};
