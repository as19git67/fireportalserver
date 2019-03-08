const _ = require('underscore');
const moment = require('moment');
const BearerStrategy = require('passport-http-bearer').Strategy;
const config = require('./config');
const Users = require('./Users');

module.exports.init = function (passport, callback) {

  passport.use(new BearerStrategy(async function (accessToken, done) {
    // console.log('Bearer Strategy with token ' + accessToken);
    // console.log('BEARER Strategy');

    let u = new Users();
    const info = {scope: '*'};
        const bearers = config.get('bearerTokens');
    let user = bearers[accessToken];

    if (user) {
      let now = moment();
      if (now.isAfter(user.expiredAfter)) {
        return done({message: 'bearer token expired ', status: 401});
      } else {
        return done(null, {name: user.name, accessRights: u.getAccessRights(user)}, info);
      }
        } else {
          if (accessToken.indexOf('.') > 0) {
            let parts = accessToken.split('.');
            let token = parts[0];
            let username = Buffer.from(parts[1], 'base64').toString('latin1');
            try {
              let user = await u.verifyTokenAndGetUser(username, token);
              return done(null, {name: username, accessRights: u.getAccessRights(user)}, info);
            } catch (ex) {
              console.log(`ERROR logging in user ${username}: ${ex.message}`);
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
