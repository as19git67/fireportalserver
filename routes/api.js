const fs = require('fs');
const path = require('path');
const express = require('express');
const passport = require('passport');
const router = express.Router();
const CORS = require('cors');
const _ = require('underscore');
const config = require('../config');
const moment = require('moment');
const nodemailer = require('nodemailer');
const formidable = require('formidable');
const Jobs = require('../Jobs');
const Users = require('../Users');
const Staff = require('../Staff');
const WebSocket = require('ws');
const crypto = require('crypto');

let corsOptions = {
  origin: false
};

// allow cors only when in development environment
if (process.env.NODE_ENV === 'development') {
  corsOptions = {
    origin: ["http://localhost:8080", "https://localhost:8080"],
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    // allowedHeaders: ['Content-Type', 'Authorization', 'Location'],
    preflightContinue: false,
    optionsSuccessStatus: 204
  };
}

function authenticate(req, res, next) {
  // check for bearer authentication header with token
  let token = '';
  if (req.headers && req.headers.authorization) {
    let parts = req.headers.authorization.split(' ');
    if (parts.length === 2) {
      let scheme = parts[0], credentials = parts[1];
      if (/^Bearer/i.test(scheme)) {
        token = credentials;
      }
    }
  }
  if (token) {
    passport.authenticate('bearer', {session: false})(req, res, next);
  } else {
    passport.authenticate('basic', {session: false})(req, res, next);
  }
}

let Right = function (right) {
  return function (req, res, next) {
    if (req.user) {
      let accessRights = req.user.accessRights;
      if (accessRights) {
        console.log(`Access rights of user ${req.user.name}: ${accessRights}`);
        if (_.contains(accessRights, right)) {
          console.log(`User ${req.user.name} has required right ${right} -> pass`);
          next();
        } else {
          console.log(`User ${req.user.name} does not have required right ${right}`);
          next({status: 403});
        }
      } else {
        console.log("Error: user object contains no accessRights");
        next({status: 500});
      }
    } else {
      console.log("Error: Rights called, but user not set in req");
      next({status: 500});
    }
  };
};

router.options('/keys', CORS(corsOptions)); // enable pre-flight

/* add a new encryption key, which replaces any current encryption key */
// perms needed: admin
router.post('/keys', CORS(corsOptions), authenticate, Right('admin'), function (req, res, next) {

  const name = req.user.name;
  const password = req.body.password;
  // todo: check password strength

  // create key from password with salt
  function _createHashPassword(password, salt) {
    const d1 = new Date();
    let passwordHash = crypto.pbkdf2Sync(Buffer.from(password), Buffer.from(salt), 2000000, 32, 'sha512');
    const d2 = new Date();
    console.log(d1.toString() + ', ' + d2.toString());
    return passwordHash.toString('base64');
  }

  function _encrypt(dataAsBase64, keyAsBase64, ivAsBase64) {
    const algorithm = 'aes-256-cbc';
    const inputEncoding = 'base64';
    const outputEncoding = 'base64';
    let cipher = crypto.createCipheriv(algorithm, Buffer.from(keyAsBase64, "base64"), Buffer.from(ivAsBase64, "base64"));
    let encrypted = cipher.update(dataAsBase64, inputEncoding, outputEncoding);
    encrypted += cipher.final(outputEncoding);
    return encrypted;
  }

  // // create random salt
  const salt = crypto.randomBytes(32).toString('base64');
  // // create random initialization vector
  // const iv = crypto.randomBytes(16).toString('base64');

  const pwHash = _createHashPassword(password, salt);

  // todo: store salt and iv together with password hash

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
  }, (err, publicKey, privateKey) => {
    if (err) {
      res.status(500).send('Generating RSA keypair failed');
      return;
    }

    // // create new AES256 encryption key
    // const aesKeyAsBase64 = crypto.randomBytes(32).toString('base64');
    // // encrypt the encryption key with pwHash
    // const aesKeySecured = _encrypt(aesKeyAsBase64, pwHash, iv);

    const u = new Users();
    try {
      const keyName = `${name}-${moment().format()}`;
      u.setPrivateKey(name, privateKey, salt, keyName)
          .then(savedEncryptionKeyName => {
            config.set('encryptionPublicKey', publicKey);
            config.set('encryptionKeyName', keyName);
            config.save(function (err) {
              if (err) {
                console.log(`Error saving RSA public key in config: ${err}`);
                res.status(500).send('Saving the new RSA public key failed');
              } else {
                console.log(`New RSA public key created by user ${name}`);
                res.json({encryptionKeyName: savedEncryptionKeyName});
              }
            });
          })
          .catch(reason => {
            res.status(500).end();
            console.log(`Exception while setting private key in users data: ${reason}`);
          });

    } catch (ex) {
      res.status(500).end();
      console.log(`Exception while saving RSA keypair: ${ex}`);
    }
  });
});

router.options('/staff', CORS(corsOptions)); // enable pre-flight

/* get all jobs */
// perms needed: canRead
router.get('/staff', CORS(corsOptions), authenticate, Right('read'), function (req, res, next) {
  const groupId = "21204";
  new Staff().getAll(groupId)
      .then(staff => {
        res.json(staff);
      })
      .catch(reason => {
        console.log("ERROR getting staff: ", reason);
        res.status(500).end();
      });
});

router.options('/jobs', CORS(corsOptions)); // enable pre-flight

/* get all jobs */
// perms needed: canRead
router.get('/jobs', CORS(corsOptions), authenticate, Right('read'), function (req, res, next) {
  new Jobs().getAll()
      .then(jobs => {
        res.json(jobs);
      })
      .catch(reason => {
        console.log("ERROR getting jobs: ", reason);
        res.status(500).end();
      });
});

router.options('/jobs/:id', CORS(corsOptions)); // enable pre-flight

/* get a specific job */
// perms needed: canRead
router.get('/jobs/:id', CORS(corsOptions), authenticate, Right('read'), function (req, res, next) {
  if (isNaN(req.params.id)) {
    res.status(400);
    res.end();
  } else {
    let complete = !!req.query.complete;
    const jobId = req.params.id;
    new Jobs().getJobById(jobId)
        .then(job => {
          if (job && !complete) {
            delete job.images
          }
          res.json(job);
        })
        .catch(reason => {
          console.log("ERROR getting job " + jobId + ": ", reason);
          res.status(500).end();
        });
  }
});

async function updateJob(jobId, req) {
  let newJobData;
  let data = req.body;
  let j = new Jobs();
  let originalJob = await j.getJobById(jobId);
  if (data.encrypted !== undefined) {
    if (data.encrypted && !originalJob.encrypted) {
      // encrypt job data
      let encryptedJob = await j.encryptJob(originalJob);
      return encryptedJob;
    } else {
      if (!data.encrypted && originalJob.encrypted) {
        // decrypt job data
        let decryptedJob = await j.decryptJob(originalJob);
        return decryptedJob;
      } else {
        console.log(`Warning: updateJob called with data.encrypted=${data.encrypted}, but job has already this state`);
        return originalJob;
      }
    }
  } else {
    if (originalJob.encrypted) {
      throw new Error("can't update encrypted job");
    }

    const levelOneKeysOfPossibleChanges = ['start', 'end', 'title', 'number', 'encrypted'];
    const attendeesKeysOfPossibleChanges = ['id', 'lastname', 'firstname'];
    const reportKeysOfPossibleChanges = ['incident', 'location', 'director', 'text', 'material', 'rescued', 'recovered', 'others', 'duration', 'staffcount',
      'writer'];
    newJobData = _.pick(data, levelOneKeysOfPossibleChanges);
    if (data.attendees) {
      newJobData.attendees = _.map(data.attendees, function (attendee) {
        return _.pick(attendee, attendeesKeysOfPossibleChanges);
      });
    }
    if (data.report) {
      if (!originalJob.report) {
        originalJob.report = {};
      }
      newJobData.report = _.extend(originalJob.report, _.pick(req.body.report, reportKeysOfPossibleChanges));
    }
  }
  let jobToSave = _.extend(originalJob, newJobData);
  let updatedJob = await j.saveJob(jobToSave);
  return updatedJob;
}

/* update a job */
// perms needed: canWrite
router.put('/jobs/:id', CORS(corsOptions), authenticate, Right('write'), function (req, res, next) {
  if (isNaN(req.params.id)) {
    res.status(400);
    res.end();
  } else {
    // complete req.body is the job object
    if (req.body) {
      const jobId = req.params.id;
      updateJob(jobId, req)
          .then(updatedJob => {
            delete updatedJob.images; // send back job without image, because it does not get updated
            res.json(updatedJob);

            // notify all clients
            _pushUpdate(req, `updatedJob:${jobId}`);
          })
          .catch(reason => {
            console.log(reason);
            res.status(500);
            res.send('Error while updating job');
          });
    } else {
      res.status(400);
      res.end();
    }
  }
});

/* delete a job */
// perms needed: isAdmin
router.delete('/jobs/:id', CORS(corsOptions), authenticate, Right('admin'), function (req, res, next) {
  if (isNaN(req.params.id)) {
    res.status(403);
    res.end();
  } else {
    new Jobs().deleteJob(req.params.id)
        .then(() => {
          res.end();
        })
        .catch(reason => {
          console.log(`ERROR deleting job with id: ${req.params.id}: ${reason}`);
          res.status(500);
          res.send('Error deleting job data');
        });
  }
});

/* add a new job */
// perms needed: bearerToken for full access (passed by firealarm)
router.post('/jobs', CORS(corsOptions), authenticate, Right('admin'), function (req, res, next) {
  let form = new formidable.IncomingForm();

  form.parse(req, function (err, fields, files) {

    let images = {};
    let file = files.alarmfax;
    if (file) {
      console.log("Received file: " + file.name + ' (' + file.type + ')');

      if (file.type === 'image/png') {
        let data = fs.readFileSync(file.path);

        let debugSavePrintfiles = config.get('debugSavePrintfiles');
        if (debugSavePrintfiles) {
          if (fs.existsSync(debugSavePrintfiles)) {
            let fullFilepath = path.join(debugSavePrintfiles, file.name);
            if (!path.extname(fullFilepath)) {
              switch (file.type) {
              case 'image/png':
                fullFilepath = fullFilepath + '.png';
                break;
              case 'text/plain':
                fullFilepath = fullFilepath + '.txt';
                break;
              }
            }
            fs.writeFile(fullFilepath, data, function (err) {
              if (err) {
                console.log("Error writing fullFilepath: ", err);
              } else {
                console.log(fullFilepath + " stored for debugging purposes");
              }
            });
          } else {
            console.log("WARNING: " + debugSavePrintfiles + " does not exist. Files to print are not stored for debugging purposes.");
          }
        }

        images.fax = "data:image/png;base64, " + data.toString('base64');
      } else {
        console.log('Skip ' + file.name + ' because of unsupported mime type (' + file.type + ')');
      }
    }
    let job = {
      start: moment(),
      end: undefined,
      title: "Einsatz",
      number: fields.number,
      keyword: fields.keyword,
      catchword: fields.catchword,
      longitude: fields.longitude,
      latitude: fields.latitude,
      street: fields.street,
      streetnumber: fields.streetnumber,
      city: fields.city,
      object: fields.object,
      resource: fields.resource,
      plan: fields.plan,
      // attendees: fields.attendees,
      // report: fields.report,
      images: images
    };
    new Jobs().addJob(job).then(addedJob => {
      res.json(addedJob.id);

      // notify all clients
      const wss = req.app.get('wss');
      if (wss) {
        wss.clients.forEach(function each(client) {
          if (client.readyState === WebSocket.OPEN) {
            console.log(`Sending push to client ${client}`);
            client.send('newJob');
          }
        });
      }
    }).catch(reason => {
      console.log("ERROR adding new job: ", reason);
      res.status(500);
      res.send('Error while adding new job data');
    });
  });
});

router.options('/verifyemail', CORS()); // enable pre-flight

// perms needed: -
// needs denial of service or misuse of service protection

let sendNextEmailNotBefore = moment();

router.post('/verifyemail', CORS(), function (req, res, next) {
  // prevent misuse of sending emails
  let now = moment();
  if (now.isBefore(sendNextEmailNotBefore)) {
    return res.status(429).end();
  }

  let data = req.body;
  if (_.isString(data['email']) && _.isString(data['name'])) {
    // console.log(JSON.stringify(data, null, 2));
    let u = new Users();
    u.getUserByName(data.name).then(existingUser => {
      if (existingUser === undefined || (existingUser && existingUser.state === 'new')) {
        u.createUser(data.name, data.email).then(user => {
          // console.log("New user: " + JSON.stringify(user, null, 2));

          // allow sending email again earliest in 1 minute
          sendNextEmailNotBefore = moment();
          sendNextEmailNotBefore.add(1, 'minutes');

          _sendVerificationEmail(data.email,
              `${req.headers.origin}/#/setupauth3?name=${data.name}&email=${data.email}&token=${user.accessToken}`)
              .then(() => {
                res.status(200).end();
              })
              .catch(reason => {
                console.log(`ERROR sending verification email: ${reason}`);
                res.status(500).end();
              });
        }).catch(reason => {
          console.log(`ERROR creating user with name ${data.name} and email ${data.email}: ${reason}`);
          res.status(500).end();
        });
      } else {
        if (existingUser) {
          console.log(`ERROR: user with name ${data.name} already exists with state ${existingUser.state} `);
          res.status(429).send('User already exists');
        }
      }
    }).catch(reason => {
      console.log(`ERROR while getting user with name ${data.name}: ${reason}`);
      res.status(500).end();
    });
  } else {
    res.status(400).end();
  }
});

router.options('/verifycode', CORS(corsOptions)); // enable pre-flight

// perms needed: - , code and name must fit
router.post('/verifycode', CORS(corsOptions), function (req, res, next) {
  let data = req.body;

  if (_.isString(data['code']) && _.isString(data['name'])) {
    let u = new Users({tokenLifetimeInMinutes: config.get('tokenLifetimeInMinutes')});
    u.getUserByName(data.name).then(existingUser => {
      if (existingUser) {
        u.verifyCodeAndCreateAccessTokenForUser(data.name, data.code)
            .then(tokenData => {
              if (tokenData) {
                if (existingUser.state === 'new') {
                  existingUser.state = 'provisioned';
                  existingUser.expiredAfter = moment().add(1, 'month');

                  u.saveUser(existingUser)
                      .then(() => {
                        res.json(tokenData);
                      })
                      .catch(reason => {
                        console.log(`ERROR while saving user with name ${existingUser.name}: ${reason}`);
                        res.status(500).end();
                      });
                } else {
                  res.json(tokenData);
                }
              } else {
                res.status(401).end();
              }
            })
            .catch(reason => {
              res.status(401).end();
            });
      } else {
        res.status(404).send('User unknown');
      }
    }).catch(reason => {
      console.log(`ERROR while getting user with name ${data.name}: ${reason}`);
      res.status(500).end();
    });
  } else {
    res.status(400).end();
  }
});

router.options('/usersecret', CORS(corsOptions)); // enable pre-flight

// perms needed: -, name and email must fit, state must be 'new'
router.get('/usersecret', CORS(corsOptions), function (req, res, next) {
  let name = req.query.name;
  let email = req.query.email;
  let token = req.query.token;
  if (name && email && token) {
    let u = new Users();
    u.verifyTokenAndGetUser(name, token, true).then(user => {
      if (user) {
        if (email === user.email && user.state === 'new') {
          u.getUserSecretByName(name, req.app.get('appName'))
              .then(secret => {
                res.json(JSON.stringify(secret));
              })
              .catch(reason => {
                console.log(`ERROR retrieving user secret for ${name}: ${reason.message}`);
                res.status(reason.status ? reason.status : 500).end();
              });
        } else {
          res.status(401).end();
        }
      } else {
        res.status(404).end();
      }
    }).catch(reason => {
      console.log(`ERROR retrieving user information for ${name}: ${reason.message}`);
      res.status(reason.status ? reason.status : 500).end();
    });
  } else {
    res.status(400).send('Missing parameters');
  }
});

router.options('/users', CORS(corsOptions)); // enable pre-flight

// perms needed: isAdmin
router.get('/users', CORS(corsOptions), authenticate, Right('admin'), function (req, res, next) {
  new Users().getAll()
      .then(users => {
        res.json(users);
      })
      .catch(reason => {
        console.log(`ERROR retrieving users: ${reason}`);
        res.status(500).end();
      });
});

router.options('/user/:name', CORS(corsOptions)); // enable pre-flight

// perms needed: isAdmin
router.get('/user/:name', CORS(corsOptions), authenticate, Right('admin'), function (req, res, next) {

  const name = req.params.name;
  new Users().getUserByName(name)
      .then(user => {
        if (user) {
          res.json(user);
        } else {
          res.status(404).end();
        }
      })
      .catch(reason => {
        console.log(`ERROR retrieving user with name ${name}: ${reason}`);
        res.status(500).end();
      });
});

// perms needed: isAdmin
router.put('/user/:name', CORS(corsOptions), authenticate, Right('admin'), function (req, res, next) {
  const name = req.params.name;
  let u = new Users();
  u.getUserByName(name)
      .then(user => {
        if (user) {
          let newUserData = _.pick(req.body, 'email', 'state', 'isAdmin', 'canRead', 'canWrite', 'isAutologin');

          if (req.user.name === name) { // modifying own user data?
            if (user.isAdmin && newUserData.isAdmin !== undefined && !newUserData.isAdmin) {
              res.status(423).send("Can't set self to non administrator");
              return;
            }
          }

          let updateUser = _.extend(user, newUserData);

          u.saveUser(updateUser)
              .then(savedUser => {
                // todo filter user data for attributes that can go over the wire
                res.json(savedUser);
              })
              .catch(reason => {
                console.log(`ERROR retrieving user with name ${name}: ${reason}`);
                res.status(500).end();
              });
        } else {
          res.status(404).end();
        }
      })
      .catch(reason => {
        console.log(`ERROR retrieving user with name ${name}: ${reason}`);
        res.status(500).end();
      });
});

// perms needed: isAdmin
router.delete('/user/:name', CORS(corsOptions), authenticate, Right('admin'), function (req, res, next) {
  const name = req.params.name;
  if (req.user.name === name) {
    res.status(423).send("Can't delete self");
  }
  let u = new Users();
  u.getUserByName(name)
      .then(user => {
        if (user) {
          u.deleteUser(user.name)
              .then(() => {
                res.end();
              })
              .catch(reason => {
                console.log(`ERROR deleting user with name ${name}: ${reason}`);
                res.status(500).end();
              });
        } else {
          res.status(404).end();
        }
      })
      .catch(reason => {
        console.log(`ERROR retrieving user with name ${name}: ${reason}`);
        res.status(500).end();
      });
});

router.options('/user', CORS(corsOptions)); // enable pre-flight

// get own userdata -> must be logged in
router.get('/user', CORS(corsOptions), authenticate, function (req, res, next) {
  if (req.user) {
    let accessRights = req.user.accessRights;
    if (accessRights) {
      console.log(`Access rights of user ${req.user.name}: ${accessRights}`);
      if (_.contains(accessRights, "read")) {

        console.log(`Reading user data of user ${req.user.name}`);
        const name = req.user.name;
        new Users().getUserByName(name)
            .then(user => {
              if (user) {
                res.json(user);
              } else {
                res.status(404).end();
              }
            })
            .catch(reason => {
              console.log(`ERROR retrieving user with name ${name}: ${reason}`);
              res.status(500).end();
            });

      } else {
        console.log(`User ${req.user.name} does not have required right read`);
        res.status(403).end();
      }
    } else {
      console.log("Error: user object contains no accessRights");
      res.status(500).end();
    }
  } else {
    console.log("Error: Rights called, but user not set in req");
    res.status(500).end();
  }
});

// update own userdata -> must be logged in
router.put('/user', CORS(corsOptions), authenticate, function (req, res, next) {
  if (req.user) {
    let accessRights = req.user.accessRights;
    if (accessRights) {
      console.log(`Access rights of user ${req.user.name}: ${accessRights}`);
      if (_.contains(accessRights, "read")) {

        console.log(`Reading user data of user ${req.user.name}`);
        const name = req.user.name;
        new Users().getUserByName(name)
            .then(user => {
              if (user) {
                let newUserData = _.pick(req.body, 'email');

                let updateUser = _.extend(user, newUserData);

                u.saveUser(updateUser)
                    .then(savedUser => {
                      // todo filter user data for attributes that can go over the wire
                      res.json(savedUser);
                    })
                    .catch(reason => {
                      console.log(`ERROR retrieving user with name ${name}: ${reason}`);
                      res.status(500).end();
                    });
              } else {
                res.status(404).end();
              }
            })
            .catch(reason => {
              console.log(`ERROR retrieving user with name ${name}: ${reason}`);
              res.status(500).end();
            });

      } else {
        console.log(`User ${req.user.name} does not have required right read`);
        res.status(403).end();
      }
    } else {
      console.log("Error: user object contains no accessRights");
      res.status(500).end();
    }
  } else {
    console.log("Error: Rights called, but user not set in req");
    res.status(500).end();
  }
});

function _pushUpdate(req, message) {
  const wss = req.app.get('wss');
  if (wss) {
    console.log(`Sending '${message}' to ${wss.clients.size} clients...`);
    wss.clients.forEach(function each(client) {
      if (client.readyState === WebSocket.OPEN) {
        console.log(`Sending push for updatedJob to client ${client._socket.remoteAddress}`);
        client.send(message);
      } else {
        console.log(`${client} has socket not open`);
      }
    });
  }
}

async function _sendVerificationEmail(recipient, link) {
  return new Promise((resolve, reject) => {

    // create reusable transport method (opens pool of SMTP connections)
    let smtpTransport = nodemailer.createTransport({
      direct: false,
      host: config.get('email_smtp_server_host'),
      port: config.get('email_smtp_server_port'),
      secureConnection: config.get('email_smtp_use_SSL'),
      auth: {
        user: config.get('email_smtp_username'),
        pass: config.get('email_smtp_password')
      }
    });

    const fromAddress = config.get('email_smtp_sender_email');

    if (recipient && _.isString(link) && link.length > 0) {
      let mailOptions = {
        from: fromAddress, // sender address
        to: recipient,
        subject: 'Email Bestätigung für Firealarm Portal der FF-Merching',
        text: 'Öffne folgendenn Link: ' + link
      };

      smtpTransport.sendMail(mailOptions, (error, info) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    } else {
      reject({error: 'recipient or link invalid'});
    }

  });
}

module.exports = router;
