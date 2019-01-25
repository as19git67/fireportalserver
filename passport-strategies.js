const _ = require('underscore');
const moment = require('moment');
const BearerStrategy = require('passport-http-bearer').Strategy;
const config = require('./config');
const Users = require('./Users');

module.exports.init = function (passport, callback) {

  passport.use(new BearerStrategy(async function (accessToken, done) {
    console.log('Bearer Strategy with token ' + accessToken);
    console.log('BEARER Strategy');

    const info = {scope: '*'};
        const bearers = config.get('bearerTokens');
    let username = bearers[accessToken];
        if (username) {
          const user = {name: username};
          done(null, user, info);
        } else {
          if (accessToken.indexOf('.') > 0) {
            try {
              let parts = accessToken.split('.');
              let token = parts[0];
              username = Buffer.from(parts[1], 'base64').toString('latin1');
              let u = new Users();
              let user = await u.verifyTokenAndGetUser(username, token);
              return done(null, {name: username, accessRights: u.getAccessRights(user)}, info);
            } catch (ex) {
              return done({message: ex.message, status: ex.status ? ex.status : 500});
            }
          }
          return done({message: 'invalid bearer token', status: 401});
        }

      }
  ));

  if (_.isFunction(callback)) {
    callback(null);
  }
};

module.exports.ensureAuthenticatedForApi = function (req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.statusCode = 401;
  res.json({error: '401 Unauthorized'});
  return null;
};
