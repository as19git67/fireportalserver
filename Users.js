const fs = require('fs');
const jf = require('jsonfile');
const _ = require('underscore');
const moment = require('moment');
const speakeasy = require('speakeasy');
const hat = require('hat');
const crypto = require('crypto');
const config = require('./config');
const forge = require('node-forge');

const usersDataFilename = 'users.json';
let usersDataFileLocked = false;

function _unlockUsersDataFile() {
  usersDataFileLocked = false;

  /*
    // Unlock file
    const fn = 'locked_' + usersDataFilename;
    fs.exists(fn, function (exists) {
      if (exists) {
        fs.unlink(fn, (err) => {
          if (err) {
            console.error(err);
          }
        });
      }
    });
  */
}

_unlockUsersDataFile();

let Users = module.exports = function (options) {
  options || (options = {});
  this.tokenLifetimeInMinutes = options.tokenLifetimeInMinutes ? options.tokenLifetimeInMinutes : 6;
  // minimum token lifetime is 6 minutes
  if (this.tokenLifetimeInMinutes < 6) {
    this.tokenLifetimeInMinutes = 6
  }

  this.filename = usersDataFilename;
  this.initialize.apply(this, arguments);
};

_.extend(Users.prototype, {
  initialize: function () {
  },

  // the lock function must be a recursive timer
  _flock: function (resolve, reject) {
    const self = this;
    if (usersDataFileLocked) {
      console.log(usersDataFilename + ' is locked. Trying again later...');
      setTimeout(() => {
        self._flock(resolve, reject)
      }, 250);
    } else {
      usersDataFileLocked = true;
      resolve();
    }

    /*
        const self = this;
        fs.symlink(this.filename, 'locked_' + this.filename, (err) => {
          if (err) {
            if (err.code === 'EEXIST') {
              console.log(usersDataFilename + ' is locked. Try again later...');
              setTimeout(() => {
                self._flock(resolve, reject)
              }, 250);
            } else {
              reject(err);
            }
          } else {
            resolve();
          }
        });
    */
  },

  _funlock: function () {
    _unlockUsersDataFile();
  },

  _initFile: function (noLock) {
    const self = this;
    return new Promise((resolve, reject) => {
      fs.exists(this.filename, function (exists) {
        if (!exists) {
          let data = {users: {}};
          jf.writeFile(self.filename, data, {spaces: 2}, function (err) {
            if (err) {
              reject(err);
            } else {
              resolve(data);
            }
          });

        } else {
          new Promise((resolve, reject) => {
            if (noLock) {
              console.log(`_initFile: not locking`);
              resolve();
            } else {
              self._flock(resolve, reject);
            }
          })
              .then(() => {
                jf.readFile(self.filename, function (err, data) {
                  if (err) {
                    reject(err);
                  } else {
                    resolve(data)
                  }
                });
              })
              .catch(reason => {
                reject(reason);
              });
        }
      });
    });
  },

  createUser: async function (username, email) {
    if (username === 'undefined' || !username) {
      throw new Error('username undefined');
    }
    const self = this;
    try {
      console.log(`createUser: _initFile`);
      await this._initFile();
      let existingUser = await this.getUserByName(username, true);
      if (existingUser) {
        if (existingUser.state === "new") {
          await self.deleteUser(existingUser.name, true)
        } else {
          throw new Error("Can't create user " + username + ", because it already exists");
        }
      }
      // generate accessToken already at this state to be able to use it in the confirmation URL
      const tokenData = {
        accessToken: hat().toString('base64'),
        accessTokenExpiresAfter: moment().add(2, 'days')
      };
      // secretData is for totp code based authentication
      const secretData = {
        secret: speakeasy.generateSecret().base32,
        expiredAfter: tokenData.accessTokenExpiresAfter
      };
      let user = await self._addUser(username, email, secretData, tokenData, true);
      return user;
    } finally {
      console.log(`createUser: unlocking - finally`);
      this._funlock();
    }
  },

  getUserByEmail: async function (email, options) {
    options || (options = {});
    try {
      console.log(`getUserByEmail: _initFile`);
      let data = await this._initFile();
      let user = _.findWhere(data.users, {email: email});
      console.log(`getUserByEmail: returning`);
      if (user) {
        return {
          username: user.username,
          email: user.email,
          state: user.state,
          canRead: user.canRead,
          canWrite: user.canWrite,
          isAdmin: user.isAdmin,
          isAutologin: user.isAutologin,
          encryptionKeyName: user.encryptionKeyName
        };
      } else {
        console.log("User with email ", email, " does not exist.");
      }
    } finally {
      console.log(`getUserByEmail: unlocking - finally`);
      this._funlock();
    }
  },

  getUserByName: async function (name, noLock) {
    if (name === 'undefined') {
      throw new Error('undefined name');
    }
    try {
      console.log(`getUserByName: _initFile`);
      let data = await this._initFile(noLock);
      const user = data.users[name];
      console.log(`getUserByName: returning`);
      if (user) {
        return {
          name: user.name,
          email: user.email,
          state: user.state,
          canRead: user.canRead,
          canWrite: user.canWrite,
          isAdmin: user.isAdmin,
          isAutologin: user.isAutologin,
          encryptionKeyName: user.encryptionKeyName
        };
      }
    } finally {
      if (!noLock) {
        console.log(`getUserByName: unlocking - finally`);
        this._funlock();
      }
    }
  },

  getUserSecretByName: async function (name, issuer) {
    if (name === 'undefined') {
      throw new Error('undefined name');
    }
    try {
      console.log(`getUserSecretByName: _initFile`);
      let data = await this._initFile();
      const user = data.users[name];
      console.log(`getUserSecretByName: returning`);
      if (user) {
        const otpauthURL = speakeasy.otpauthURL({secret: user.secret, encoding: 'base32', label: user.email, issuer: issuer});
        return {
          secret: user.secret,
          otpauthURL: otpauthURL
        };
      }
    } finally {
      console.log(`getUserSecretByName: unlocking - finally`);
      this._funlock();
    }
  },

  verifyCode: async function (name, code) {
    if (name === 'undefined' || !name) {
      throw new Error('undefined name');
    }
    try {
      console.log(`verifyCode: _initFile, name: ${name}`);
      let data = await this._initFile();
      const user = data.users[name];
      if (user) {
        let ok = await new Promise((resolve, reject) => {

          if (process.env.NODE_ENV === 'development' && code === '000000') {
            console.log("WARNING: token validation bypassed for debugging");
            resolve(true);
            return;
          }

          let tokenValidates = speakeasy.totp.verify({
            secret: user.secret,
            encoding: 'base32',
            token: code,
            window: 6
          });

          console.log(`verifyCode: waiting artificially before resolving promise with ${tokenValidates}`);
          setTimeout(function () {
            resolve(tokenValidates);
          }, 2 * 1000);
        });
        console.log(`verifyCode: returning ${ok}`);
        return ok;
      } else {
        throw new Error('Unknown user');
      }
    } finally {
      console.log(`verifyCode: unlocking - finally`);
      this._funlock();
    }
  },

  verifyCodeAndCreateAccessTokenForUser: async function (name, code) {
    if (name === 'undefined' || !name) {
      throw new Error('undefined name');
    }

    let codeOk = await this.verifyCode(name, code);
    if (codeOk) {
      const tokenValue = hat().toString('base64');
      const self = this;
      const filename = this.filename;
      try {
        console.log(`verifyCodeAndCreateAccessTokenForUser: _initFile`);
        let data = await this._initFile();
        let user = data.users[name];
        if (user) {
          let tokenData = {
            accessToken: tokenValue
          };
          if (user.isAutologin) {
            tokenData.accessTokenExpiresAfter = moment("9999-12-31");
            tokenData.isAutologin = true
          } else {
            tokenData.accessTokenExpiresAfter = moment().add(this.tokenLifetimeInMinutes, 'minutes')
          }
          _.extend(user, {accessToken: tokenData.accessToken, accessTokenExpiresAfter: tokenData.accessTokenExpiresAfter});
          let tokenDataToReturn = await new Promise((resolve, reject) => {
            jf.writeFile(filename, data, {spaces: 2}, function (error) {
              if (error) {
                console.log(`verifyCodeAndCreateAccessTokenForUser: error writing ${filename}`);
                reject(error);
              } else {
                console.log(`verifyCodeAndCreateAccessTokenForUser: ${filename} written`);
                tokenData.accessRights = self.getAccessRights(user);
                tokenData.encryptionKeyName = user.encryptionKeyName;
                resolve(tokenData);
              }
            });
            console.log(`verifyCodeAndCreateAccessTokenForUser: started writing ${filename}`);
          });
          console.log(`verifyCodeAndCreateAccessTokenForUser: returning token`);
          return tokenDataToReturn;
        } else {
          throw new Error("User does not exist");
        }
      } finally {
        console.log(`verifyCodeAndCreateAccessTokenForUser: unlocking - finally`);
        this._funlock();
      }
    }
  },

  refreshToken: async function (name) {
    if (name === 'undefined' || !name) {
      throw {message: 'undefined name', status: 401};
    }
    const filename = this.filename;
    try {
      console.log(`refreshToken: _initFile`);
      let data = await this._initFile();
      let user = data.users[name];
      if (user) {
        let now = moment();
        if (now.isAfter(user.expiredAfter)) {
          throw {message: 'user expired', status: 401};
        } else {
          if (user.state === 'provisioned') {
            const tokenValue = hat().toString('base64');
            let tokenData = {
              refreshAccessToken: tokenValue
            };
            if (user.isAutologin) {
              tokenData.refreshAccessTokenExpiresAfter = moment("9999-12-31");
            } else {
              tokenData.refreshAccessTokenExpiresAfter = moment().add(this.tokenLifetimeInMinutes, 'minutes')
            }
            _.extend(user, {refreshAccessToken: tokenData.refreshAccessToken, refreshAccessTokenExpiresAfter: tokenData.refreshAccessTokenExpiresAfter});
            const tokenDataToReturn = await new Promise((resolve, reject) => {
              jf.writeFile(filename, data, {spaces: 2}, function (error) {
                if (error) {
                  console.log(`refreshToken: error writing ${filename}`);
                  reject(error);
                } else {
                  console.log(`refreshToken: ${filename} written`);
                  resolve(tokenData);
                }
              });
              console.log(`refreshToken: started writing ${filename}`);
            });
            console.log(`refreshToken: returning token`);
            return tokenDataToReturn;
          } else {
            throw {message: 'user is not provisioned', status: 401};
          }
        }
      } else {
        throw new {message: "user does not exist", status: 401};
      }
    } finally {
      console.log(`refreshToken: unlocking - finally`);
      this._funlock();
    }
  },

  verifyTokenAndGetUser: async function (name, token, newToo) {
    try {
      console.log(`verifyTokenAndGetUser: _initFile, name: ${name}`);
      let data = await this._initFile();
      if (name === 'undefined' || !name) {
        throw {message: 'undefined name', status: 401};
      }
      if (!token) {
        throw {message: 'invalid access token', status: 401};
      }
      let user = data.users[name];
      if (user) {
        let now = moment();
        if (now.isAfter(user.expiredAfter)) {
          throw {message: 'user expired', status: 401};
        } else {
          if (newToo || user.state === 'provisioned') {
            if (user.refreshAccessToken === token) {
              user.accessToken = user.refreshAccessToken;
              delete user.refreshAccessToken;
              user.accessTokenExpiresAfter = user.refreshAccessTokenExpiresAfter;
              delete user.refreshAccessTokenExpiresAfter;
              const filename = this.filename;
              await new Promise((resolve, reject) => {
                jf.writeFile(filename, data, {spaces: 2}, function (error) {
                  if (error) {
                    console.log(`verifyTokenAndGetUser: error writing ${filename}`);
                    reject(error);
                  } else {
                    console.log(`verifyTokenAndGetUser: ${filename} written`);
                    resolve();
                  }
                });
                console.log(`verifyTokenAndGetUser: started writing ${filename}`);
              });
            }
            if (user.accessToken === token) {
              if (now.isAfter(user.accessTokenExpiresAfter)) {
                throw {message: 'access token expired', status: 401};
              } else {
                console.log(`verifyTokenAndGetUser: returning user data`);
                return _.pick(user, 'name', 'email', 'state', 'canRead', 'canWrite', 'isAdmin', 'expiredAfter', 'encryptionKeyName');
              }
            } else {
              throw {message: 'invalid access token', status: 401};
            }
          } else {
            throw {message: 'user is not provisioned', status: 401};
          }
        }
      } else {
        throw new {message: "user does not exist", status: 401};
      }
    } finally {
      console.log(`verifyTokenAndGetUser: unlocking - finally`);
      this._funlock();
    }
  },

  getAccessRights: function (user) {
    const publicKeyName = config.get('encryptionKeyName');
    let accessRights = [];
    if (user.isAdmin) {
      accessRights.push('admin');
      accessRights.push('read');
      accessRights.push('write');
      if (user.encryptionKeyName) {
        accessRights.push('decrypt');
      }
      if (publicKeyName) {
        accessRights.push('encrypt');
      }
    } else {
      if (user.canRead) {
        accessRights.push('read');
      }
      if (user.canWrite) {
        accessRights.push('write');

        // encrypt must have right to write and public key must be configured
        if (publicKeyName) {
          accessRights.push('encrypt');
        }
      }
      if (user.encryptionKeyName) {
        accessRights.push('decrypt');
      }
    }
    return accessRights;
  },

  getAll: async function () {
    try {
      console.log(`getAll: _initFile`);
      let data = await this._initFile();
      if (data) {
        // let notExpiredUsers = _.filter(data.users, function (user) {
        //   if (!user.expiredAfter) {
        //     user.expiredAfter = "9999-12-31";
        //     return true;
        //   } else {
        //     let ea = moment(user.expiredAfter);
        //     return moment().isBefore(ea)
        //   }
        // });
        console.log(`getAll: returning user data`);
        return _.map(data.users, function (user) {
          return {
            name: user.name,
            email: user.email,
            state: user.state,
            canRead: user.canRead,
            canWrite: user.canWrite,
            isAdmin: user.isAdmin,
            isAutologin: user.isAutologin,
            expiredAfter: user.expiredAfter,
            encryptionKeyName: user.encryptionKeyName
          };
        });
      } else {
        console.log(`getAll: returning empty list of user data`);
        return [];
      }
    } finally {
      console.log(`getAll: unlocking - finally`);
      this._funlock();
    }
  },

  _addUser: async function (name, email, secretData, tokenData, noLock) {
    if (name === 'undefined' || !name) {
      throw new Error('undefined name');
    }
    try {
      console.log(`_addUser: _initFile (noLock: ${noLock})`);
      let data = await this._initFile(noLock);
      if (data.users[name]) {
        throw new Error("Can't add existing user");
      } else {
        let user = {
          name: name,
          email: email,
          secret: secretData.secret,
          state: 'new',
          canRead: false,
          canWrite: false,
          isAdmin: false,
          isAutologin: false,
          expiredAfter: secretData.expiredAfter,
          accessToken: tokenData.accessToken,
          accessTokenExpiresAfter: tokenData.accessTokenExpiresAfter
        };
        data.users[user.name] = user;
        const filename = this.filename;
        const userToReturn = await new Promise((resolve, reject) => {
          jf.writeFile(filename, data, {spaces: 2}, function (error) {
            if (error) {
              console.log(`_addUser: error writing ${filename}`);
              reject(error);
            } else {
              console.log(`_addUser: ${filename} written`);
              resolve(user);
            }
          });
          console.log(`_addUser: started writing ${filename}`);
        });
        console.log(`_addUser: returning user data`);
        return userToReturn;
      }
    } finally {
      if (!noLock) {
        console.log(`_addUser: unlocking - finally`);
        this._funlock();
      }
    }
  },

  // create key from password with salt
  _createHashPassword: function (password, salt) {
    const d1 = new Date();
    let passwordHash = crypto.pbkdf2Sync(Buffer.from(password), Buffer.from(salt), 2000000, 32, 'sha512');
    const d2 = new Date();
    console.log(d1.toString() + ', ' + d2.toString());
    return passwordHash.toString('base64');
  },

  createNewKeyPair: async function (username, password) {
    try {
      console.log(`createNewKeyPair: _initFile`);
      await this._initFile();  // init to lock the datafile
      let user = await this.getUserByName(username, true);
      if (user) {
        return new Promise((resolve, reject) => {

          // create random salt
          const salt = crypto.randomBytes(32).toString('base64');

          const pwHash = this._createHashPassword(password, salt);

          // create new RSA keypair
          crypto.generateKeyPair('rsa', {
            modulusLength: 4096,
            publicKeyEncoding: {
              type: 'spki',
              format: 'pem'
            },
            privateKeyEncoding: {
              type: 'pkcs8',
              format: 'pem',
              cipher: 'aes-256-cbc',
              passphrase: pwHash
            }
          }, async (err, publicKey, privateKey) => {
            if (err) {
              reject(err);
              return;
            }

            // // create new AES256 encryption key
            // const aesKeyAsBase64 = crypto.randomBytes(32).toString('base64');
            // // encrypt the encryption key with pwHash
            // const aesKeySecured = _encrypt(aesKeyAsBase64, pwHash, iv);

            const keyName = `${username}-${moment().format()}`;

            user.encryptedPrivateKey = privateKey;
            user.encryptionPrivateKeySalt = salt;
            user.encryptionKeyName = keyName;
            let savedUser = await this.saveUser(user);
            resolve({encryptionKeyName: savedUser.encryptionKeyName, encryptionPublicKey: publicKey});
          });
        });
      } else {
        throw new Error(`User ${username} does not exist`);
      }
    } finally {
      console.log(`createNewKeyPair: unlocking - finally`);
      this._funlock();
    }
  },

  getPrivateKey: async function (username, password) {
    if (!password) {
      throw new Error("Can't get private key without password");
    }
    try {
      console.log(`getPrivateKey: _initFile`);
      let data = await this._initFile();
      const user = data.users[username];
      if (user) {
        let salt = user.encryptionPrivateKeySalt;
        let privateKey = user.encryptedPrivateKey;
        if (salt && privateKey) {
          const pwHash = this._createHashPassword(password, salt);
          console.log(`getPrivateKey: returning private key with hashed password`);
          return {encryptedPrivateKey: privateKey, passphrase: pwHash, encryptionKeyName: user.encryptionKeyName};
        } else {
          throw new Error(`User ${username} has no decryption key`);
        }
      } else {
        throw new Error(`Unknown user ${username}`);
      }
    } finally {
      console.log(`getPrivateKey: unlocking - finally`);
      this._funlock();
    }
  },

  migratePrivateKey: async function (sourceUsername, sourcePrivateKeyPassword, sourceKeyname, targetUsername, targetPrivateKeyPassword) {
    if (!sourcePrivateKeyPassword) {
      throw new Error("Can't get source private key without password");
    }
    if (!targetPrivateKeyPassword) {
      throw new Error("Can't save target private key without password");
    }
    try {
      console.log(`migratePrivateKey: _initFile`);
      let data = await this._initFile();
      const sourceUser = data.users[sourceUsername];
      if (sourceUser) {
        const targetUser = data.users[targetUsername];
        if (targetUser) {
          if (targetUser.encryptionKeyName) {
            throw new Error(`User ${username} already has a decryption key (${targetUser.encryptionKeyName}) set`)
          }
          if (sourceUser.encryptionKeyName === sourceKeyname) {
            let salt = sourceUser.encryptionPrivateKeySalt;
            if (salt && sourceUser.encryptedPrivateKey) {
              const sourcePasswordHash = this._createHashPassword(sourcePrivateKeyPassword, salt);

              const pki = forge.pki;
              let sourceKeyBuffer = Buffer.from(sourceUser.encryptedPrivateKey);
              const privateKey = pki.decryptRsaPrivateKey(sourceKeyBuffer, sourcePasswordHash);
              if (privateKey) {
                // create random salt for target user
                salt = crypto.randomBytes(32).toString('base64');
                const targetPasswordHash = this._createHashPassword(targetPrivateKeyPassword, salt);
                const targetPrivateKeyAsPem = pki.encryptRsaPrivateKey(privateKey, targetPasswordHash);
                targetUser.encryptedPrivateKey = targetPrivateKeyAsPem;
                targetUser.encryptionPrivateKeySalt = salt;
                targetUser.encryptionKeyName = sourceUser.encryptionKeyName;

                let savedUser = await this.saveUser(targetUser);
                console.log(`migratePrivateKey: returning key name ${savedUser.encryptionKeyName}`);
                return {encryptionKeyName: savedUser.encryptionKeyName};
              } else {
                throw new Error(`Password for key ${sourceUser.encryptionKeyName} is wrong.`)
              }
            } else {
              throw new Error(`User ${sourceUsername} has no decryption key`);
            }
          } else {
            throw new Error(`User ${sourceUsername} does not have private key ${sourceUser.encryptionKeyName}`);
          }
        } else {
          throw new Error(`Unknown target user ${targetUsername}`);
        }
      } else {
        throw new Error(`Unknown source user ${sourceUsername}`);
      }
    } finally {
      console.log(`migratePrivateKey: unlocking - finally`);
      this._funlock();
    }
  },

  deletePrivateKey: async function (username, encryptionKeyName) {
    try {
      console.log(`deletePrivateKey: _initFile`);
      let data = await this._initFile();
      const user = data.users[username];
      if (!user) {
        throw new Error(`User ${username} does not exist`);
      }
      if (user.encryptionKeyName !== encryptionKeyName) {
        throw new Error(`User ${username} does not have decryptionKeyName ${encryptionKeyName}`);
      }

      user.encryptionKeyName = '';
      user.encryptedPrivateKey = '';
      user.encryptionPrivateKeySalt = '';

      await this.saveUser(user);
      return await this.getUserByName(username, true);
    } finally {
      console.log(`deletePrivateKey: unlocking - finally`);
      this._funlock();
    }
  },

  /* updates user information - without secret and otpCounter */
  saveUser: async function (user) {
    if (!user) {
      throw new Error('undefined user');
    }
    if (!user.name) {
      const err = "ERROR: attempt to save incomplete user";
      console.log(err);
      throw new Error(err);
    }
    const filename = this.filename;
    console.log(`saveUser: _initFile (noLock: true)`);
    let data = await this._initFile(true);  // don't lock file again, because caller of saveUser must/did lock already
    if (data.users[user.name]) {
      _.extend(data.users[user.name],
          _.pick(user, 'name', 'email', 'state', 'canRead', 'canWrite', 'isAdmin', 'isAutologin', 'expiredAfter', 'encryptedPrivateKey',
              'encryptionPrivateKeySalt', 'encryptionKeyName'));
      const savedUserToReturn = await new Promise((resolve, reject) => {
        jf.writeFile(filename, data, {spaces: 2}, function (error) {
          if (error) {
            console.log(`saveUser: error writing ${filename}`);
            reject(error);
          } else {
            console.log(`saveUser: ${filename} written`);
            let savedUser = data.users[user.name];
            resolve({
              name: savedUser.name,
              email: savedUser.email,
              state: savedUser.state,
              canRead: savedUser.canRead,
              canWrite: savedUser.canWrite,
              isAdmin: savedUser.isAdmin,
              isAutologin: savedUser.isAutologin,
              expiredAfter: savedUser.expiredAfter,
              encryptionKeyName: savedUser.encryptionKeyName
            });
          }
        });
        console.log(`saveUser: started writing ${filename}`);
      });
      console.log('saveUser: returning saved user data');
      return savedUserToReturn;
    } else {
      throw new Error("User does not exist")
    }
  },

  deleteUser: async function (name, noLock) {
    if (!name) {
      const err = "ERROR: attempt to delete user with undefined name";
      throw new Error(err);
    }
    try {
      console.log(`deleteUser: _initFile (noLock: ${noLock})`);
      let data = await this._initFile(noLock);
      let user = data.users[name];
      if (user.isAdmin) {
        let otherAdmin = _.find(data.users, function (u) {
          return u.isAdmin && u.name !== user.name;
        });
        if (!otherAdmin) {
          throw new Error("Can't delete last administrator");
        }
      }
      if (user.encryptionKeyName) {
        let otherUserCanDecrypt = _.find(data.users, function (u) {
          return u.encryptionKeyName && u.name !== user.name;
        });
        if (!otherUserCanDecrypt) {
          throw new Error("Can't delete last user that can decrypt");
        }
      }
      delete data.users[name];
      const filename = this.filename;
      await new Promise((resolve, reject) => {
        jf.writeFile(filename, data, {spaces: 2}, function (error) {
          if (error) {
            console.log(`deleteUser: error writing ${filename}`);
            reject(error);
          } else {
            console.log(`deleteUser: ${filename} written`);
            resolve();
          }
        });
        console.log(`deleteUser: started writing ${filename}`);
      });
    } finally {
      if (!noLock) {
        console.log(`deleteUser: unlocking - finally`);
        this._funlock();
      }
    }
  }
});

// Helpers
// -------

// Helper function to correctly set up the prototype chain, for subclasses.
// Similar to `goog.inherits`, but uses a hash of prototype properties and
// class properties to be extended.
var extend = function (protoProps, staticProps) {
  var parent = this;
  var child;

  // The constructor function for the new subclass is either defined by you
  // (the "constructor" property in your `extend` definition), or defaulted
  // by us to simply call the parent's constructor.
  if (protoProps && _.has(protoProps, 'constructor')) {
    child = protoProps.constructor;
  } else {
    child = function () {
      return parent.apply(this, arguments);
    };
  }

  // Add static properties to the constructor function, if supplied.
  _.extend(child, parent, staticProps);

  // Set the prototype chain to inherit from `parent`, without calling
  // `parent`'s constructor function.
  var Surrogate = function () {
    this.constructor = child;
  };
  Surrogate.prototype = parent.prototype;
  child.prototype = new Surrogate();

  // Add prototype properties (instance properties) to the subclass,
  // if supplied.
  if (protoProps) {
    _.extend(child.prototype, protoProps);
  }

  // Set a convenience property in case the parent's prototype is needed
  // later.
  child.__super__ = parent.prototype;

  return child;
};

Users.extend = extend;
