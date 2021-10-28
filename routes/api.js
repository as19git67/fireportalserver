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
const Material = require('../Material');
const WebSocket = require('ws');
const forge = require('node-forge');

module.exports = function (app) {
  let corsOptions = {
    origin: false
  };

  // store a debounced function to perform backup of jobs.json (only encrypted entries)
  app.set('backupJobs',
    _.debounce(function (jobs) {
      if (!(jobs instanceof Jobs)) {
        jobs = new Jobs();
      }
      jobs.backupJobs();
    }, 1000 * 60 * 10)
  );

  // store a debounced function to perform backup of staff.json
  app.set('backupStaff',
    _.debounce(function (staff) {
      if (!(staff instanceof Staff)) {
        staff = new Staff();
      }
      staff.backupStaff();
    }, 1000 * 60 * 10)
  );

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

  let Right = function (right, alternativeRight) {
    return function (req, res, next) {
      if (req.user) {
        let accessRights = req.user.accessRights;
        if (accessRights) {
          console.log(`Access rights of user ${req.user.name}: ${accessRights}`);
          if (_.contains(accessRights, right)) {
            console.log(`User ${req.user.name} has required right ${right} -> pass`);
            next();
          } else {
            if (_.contains(accessRights, alternativeRight)) {
              console.log(`User ${req.user.name} has required alternativeRight ${alternativeRight} -> pass`);
              next();
            } else {
              console.log(`User ${req.user.name} does not have required right ${right}`);
              next({status: 403});
            }
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

  router.options('/materialmeta', CORS(corsOptions)); // enable pre-flight

  /* get material metadata */
  // perms needed: canRead
  router.get('/materialmeta', CORS(corsOptions), authenticate, Right('read'), function (req, res, next) {
    new Material().getMeta()
    .then(meta => {
      res.json(meta);
    })
    .catch(reason => {
      console.log("ERROR getting meta: ", reason);
      res.status(500).end();
    });
  });

  router.options('/materialtypes', CORS(corsOptions)); // enable pre-flight

  /* get material types */
  // perms needed: canRead
  router.get('/materialtypes', CORS(corsOptions), authenticate, Right('read'), function (req, res, next) {
    new Material().getTypes()
    .then(materialTypes => {
      res.json(materialTypes);
    })
    .catch(reason => {
      console.log("ERROR getting materialTypes: ", reason);
      res.status(500).end();
    });
  });

  router.options('/staff', CORS(corsOptions)); // enable pre-flight

  /* get all staff members */
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
    const withImages = !!req.query.withImages;
    new Jobs().getAll({withImages: withImages})
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
      const username = req.user.name;
      const jobId = req.params.id;
      const passphrase = req.headers.password;
      const keyName = req.headers.encryptionkeyname;
      const withImages = !!req.query.withImages;
      if (passphrase && keyName) {
        new Users().getPrivateKey(username, passphrase)
        .then(keyObj => {
          if (keyName === keyObj.encryptionKeyName) {
            if (keyObj.encryptedPrivateKey && keyObj.passphrase) {
              let privateKey;
              // check passphrase before trying to decrypt to get a better error message in case the passphrase is wrong
              const pki = forge.pki;
              let keyBuf = Buffer.from(keyObj.encryptedPrivateKey);

              try {
                privateKey = pki.decryptRsaPrivateKey(keyBuf, keyObj.passphrase);
              } catch (ex) {
                // assume if decryptRsaPrivateKey fails that the password is wrong -> privateKey stays empty -> wrong password
              }
              if (privateKey) {
                // passphrase was ok ...
                console.log(`Decrypting job ${jobId} by user ${username}...`);
                new Jobs().getJobById(jobId, keyObj)
                .then(decryptedJob => {
                  if (decryptedJob && !withImages) {
                    delete decryptedJob.images;
                  }
                  res.json(decryptedJob);
                })
                .catch(reason => {
                  console.log(`ERROR decrypting job with id ${jobId} using key ${keyName}: `, reason);
                  res.status(500).end();
                });
              } else {
                res.status(403).send('Das Passwort ist falsch');
              }
            } else {
              console.log("encryptedPrivateKey or passphrase missing in keyObj");
              res.status(400).end();
            }
          } else {
            console.log("Name of users key differs from given key name: " + keyName);
            res.status(400).end();
          }
        })
        .catch(reason => {
          console.log("ERROR getting private key " + keyName + ": ", reason);
          res.status(500).end();
        });
      } else {
        new Jobs().getJobById(jobId)
        .then(job => {
          if (job && !withImages) {
            delete job.images;
          }
          res.json(job);
        })
        .catch(reason => {
          console.log("ERROR getting job " + jobId + ": ", reason);
          res.status(500).end();
        });
      }
    }
  });

  async function updateJob(jobId, req) {
    let newJobData;
    let data = req.body;
    let j = new Jobs();
    try {
      j.lock();
      const username = req.user.name;
      let originalJob = await j.getJobById(jobId);
      if (data.encrypted !== undefined) {
        if (data.encrypted && !originalJob.encrypted) {
          // encrypt job data
          console.log(`Encrypting job ${jobId} by user ${username}...`);
          let encryptedJob = await j.encryptJob(originalJob);
          console.log(`Encrypted job ${jobId} by user ${username}.`);
          req.app.get('backupJobs')(j); // backup jobs
          return {updatedJob: encryptedJob, decrypted: false};
        } else {
          if (!data.encrypted && originalJob.encrypted) {
            // decrypt job data
            const u = new Users();
            const keyObj = await u.getPrivateKey(username, data.passphrase);
            console.log(`Decrypting job ${jobId} by user ${username}...`);
            let decryptedJob = await j.decryptJob(originalJob, keyObj);
            console.log(`Decrypted job ${jobId} by user ${username}.`);
            req.app.get('backupJobs')(j); // backup jobs
            return {updatedJob: decryptedJob, decrypted: true};
          } else {
            console.log(`Warning: updateJob called with data.encrypted=${data.encrypted}, but job has already this state`);
            return {updatedJob: originalJob, decrypted: false};
          }
        }
      } else {
        if (originalJob.encrypted) {
          throw new Error("can't update encrypted job");
        }

        const levelOneKeysOfPossibleChanges = ['start', 'end', 'title', 'number', 'encrypted'];
        const attendeesKeysOfPossibleChanges = ['id', 'lastname', 'firstname'];
        const reportKeysOfPossibleChanges = [
          'incident', 'location', 'director', 'text', 'materialList', 'rescued', 'recovered', 'others', 'duration', 'staffcount',
          'writer'
        ];
        const materialListKeysOfPossibleChanges = ['id', 'matId', 'name', 'category', 'values'];
        newJobData = _.pick(data, levelOneKeysOfPossibleChanges);
        if (data.attendees) {
          newJobData.attendees = _.map(data.attendees, function (attendee) {
            return _.pick(attendee, attendeesKeysOfPossibleChanges);
          });
        }
        if (data.report) {
          if (!originalJob.report) {
            originalJob.report = {materialList: []};
          } else {
            if (!originalJob.report.materialList) {
              originalJob.report.materialList = [];
            }
          }
          newJobData.report = _.extend(originalJob.report, _.pick(data.report, reportKeysOfPossibleChanges));
          if (data.report.materialList) {
            // update material list if there was material sent with the request
            newJobData.report.materialList = [];
            _.each(data.report.materialList, material => {
              newJobData.report.materialList.push(_.pick(material, materialListKeysOfPossibleChanges));
            });
          }
        }
      }
      let jobToSave = _.extend(originalJob, newJobData);
      let updatedJob = await j.saveJob(jobToSave);
      req.app.get('backupJobs')(j); // backup jobs
      return {updatedJob: updatedJob, decrypted: false};
    } finally {
      j.unlock();
    }
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
        .then(result => {
          let updatedJob = result.updatedJob;
          const decrypted = result.decrypted;
          delete updatedJob.images; // send back job without image, because it does not get updated
          res.json(updatedJob);

          setTimeout(function () {
            // notify all clients
            if (decrypted) {
              _pushUpdate(req, `decryptedJob:${jobId}`);
            } else {
              _pushUpdate(req, `updatedJob:${jobId}`);
            }
          }, 1000);
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
  // perms needed: isAdmin or isWrite if manually created
  router.delete('/jobs/:id', CORS(corsOptions), authenticate, Right('write'), function (req, res, next) {
    const reportAttributesExceptions = ['director', 'writer'];
    if (isNaN(req.params.id)) {
      res.status(403);
      res.end();
    } else {
      const jobId = req.params.id;
      let j = new Jobs();
      j.getJobById(jobId)
      .then((job) => {
        let accessGranted = false;
        // check if job data was set and if it has, then require admin right for deletion
        let reportEdited = !!_.find(_.keys(job.report), key => {
          if (_.contains(reportAttributesExceptions, key)) {
            return false; // don't check this attribute for any value
          }
          if (key === 'materialList') {
            const matList = job.report[key];
            if (!matList || !matList.length) {
              return false; // ignore empty material list
            }
          }

          const attribute = job.report[key];
          if (_.isString(attribute)) {
            const num = parseFloat(attribute);
            if (isNaN(num)) {
              return attribute.trim();
            } else {
              return num;  // evaluates to false if 0
            }
          } else {
            return attribute;
          }
        });
        if (job.number || job.keyword || job.catchword || _.values(job.attendees).length || reportEdited) {
          console.log(`job's number, keyword, catchword, etc are. not all empty. Admin rights required for deletion`);
          let accessRights = req.user.accessRights;
          if (accessRights) {
            console.log(`Access rights of user ${req.user.name}: ${accessRights}`);
            if (_.contains(accessRights, "read")) {
              let accessRights = req.user.accessRights;
              if (accessRights) {
                console.log(`Access rights of user ${req.user.name}: ${accessRights}`);
                if (_.contains(accessRights, "admin")) {
                  console.log(`User ${req.user.name} has right 'admin' -> user can delete job`);
                  accessGranted = true;
                }
              }
            }
          } else {
            console.log("Error: user object contains no accessRights");
            res.status(500).end();
          }
        } else {
          accessGranted = true;
        }

        if (accessGranted) {
          j.deleteJob(jobId)
          .then(() => {
            req.app.get('backupJobs')(j); // backup jobs
            res.end();
            _pushUpdate(req, `deletedJob:${jobId}`);
          })
          .catch(reason => {
            console.log(`ERROR deleting job with id: ${jobId}: ${reason}`);
            res.status(500);
            res.send('Error deleting job data');
          });
        } else {
          console.log(`User ${req.user.name} does not have required right to delete the job`);
          res.status(403).end();
        }
      })
      .catch(reason => {
        console.log(`ERROR deleting job with id: ${jobId}: ${reason}`);
        res.status(500);
        res.send('Error deleting job');
      });

    }
  });

  function _makeAddress(data) {
    let street = _.isArray(data.street) && data.street.length > 0 ? data.street[0] : data.street;
    let streetnumber = _.isArray(data.streetnumber) && data.streetnumber.length > 0 ? data.streetnumber[0] : data.streetnumber;
    let city = _.isArray(data.city) && data.city.length > 0 ? data.city[0] : data.city;
    let object = _.isArray(data.object) && data.object.length > 0 ? data.object[0] : data.object;
    let streetParts = [];
    if (street) {
      streetParts.push(street);
    }
    if (streetnumber) {
      streetParts.push(streetnumber);
    }
    let streetAddress = streetParts.join(' ');
    let addressParts = [];
    if (streetAddress) {
      addressParts.push(streetAddress);
    }
    if (city) {
      addressParts.push(city);
    }
    if (object) {
      addressParts.push(object);
    }
    return addressParts.join(', ');
  }

  function _parseJsonArray(value) {
    if (_.isString(value) && value.charAt(0) === '[') {
      try {
        return JSON.parse(value);
      } catch (ex) {
        console.log(`WARNING: JSON parse failed with ${value}`);
      }
    } else {
      return value;
    }

  }

  function _makeMaterial(data) {
    if (data.resource) {
      let value = _parseJsonArray(data.resource);
      if (_.isArray(value)) {
        let resources = _.filter(value, function (o) {
          return o.indexOf('erching') > 1;
        });
        return resources.join(', ');
      } else {
        return value;
      }
    } else {
      return '';
    }
  }

  function _makeOthers(data) {
    if (data.resource) {
      let value = _parseJsonArray(data.resource);
      if (_.isArray(value)) {
        let others = _.reject(value, function (o) {
          return o.indexOf('erching') > 0;
        });
        return others.join(', ');
      } else {
        return '';
      }
    } else {
      return '';
    }
  }

  /* add a new job */
  // perms needed: write access or  bearerToken for write access (passed by firealarm)
  router.post('/jobs', CORS(corsOptions), authenticate, Right('write'), function (req, res, next) {

    let job;

    function handlePostedJob() {
      if (job) {
        let j = new Jobs();
        j.addJob(job).then(addedJob => {
          req.app.get('backupJobs')(j); // backup jobs
          res.json({id: addedJob.id});

          // notify all clients
          const wss = req.app.get('wss');
          if (wss) {
            wss.clients.forEach(function each(client) {
              if (client.readyState === WebSocket.OPEN) {
                console.log(`Sending push to client ${client._socket.remoteAddress}`);
                client.send(`newJob:${addedJob.id}`);
              }
            });
          }
        }).catch(reason => {
          console.log("ERROR adding new job: ", reason);
          res.status(500);
          res.send('Error while adding new job data');
        });
      }
    }

    if (req.is('json')) {
      job = {
        start: moment(),
        end: undefined,
        title: req.body.title ? req.body.title : "Einsatz (manuell angelegt)",
        number: req.body.number,
        keyword: req.body.keyword,
        catchword: req.body.catchword,
        longitude: req.body.longitude,
        latitude: req.body.latitude,
        street: req.body.street,
        streetnumber: req.body.streetnumber,
        city: req.body.city,
        object: req.body.object,
        resource: req.body.resource,
        plan: req.body.plan,
        report:
          {}
      };
      handlePostedJob();
    } else {
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
        job = {
          start: moment(),
          end: undefined,
          title: fields.title ? fields.title : "Einsatz",
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
          report: {
            incident: (fields.keyword ? fields.keyword : '') + (fields.catchword ? ', ' + fields.catchword : ''),
            location: _makeAddress(fields),
            duration: 0,
            rescued: 0,
            recovered: 0
            // material: _makeMaterial(fields),
            // others: _makeOthers(fields)
          },
          images: images
        };

        handlePostedJob();

      });
    }

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
    if (_.isString(data.email) && data.email && _.isString(data.name) && data.name) {
      // console.log(JSON.stringify(data, null, 2));
      let u = new Users();
      try {
        u.lock();
        new Promise(async (resolve, reject) => {
          let existingUser;
          try {
            existingUser = await u.getUserByName(data.name);
          } catch (ex) {
            reject({
              message: `ERROR while getting user with name ${data.name}: ${ex.message}`,
              status: 500,
              exception: ex
            });
            return;
          }
          if (existingUser === undefined || (existingUser && existingUser.state === 'new')) {
            let user;
            try {
              user = await u.createUser(data.name, data.email);
              // console.log("New user: " + JSON.stringify(user, null, 2));

              // allow sending email again earliest in 1 minute
              sendNextEmailNotBefore = moment();
              sendNextEmailNotBefore.add(1, 'minutes');
            } catch (ex) {
              reject({
                message: `ERROR creating user with name ${data.name} and email ${data.email}: ${ex.message}`,
                status: 500,
                exception: ex
              });
              return;
            }
            try {
              await _sendVerificationEmail(data.email,
                `${req.headers.origin}/#/setupauth3?name=${data.name}&email=${data.email}&token=${user.accessToken}`);

              resolve();

            } catch (ex) {
              reject({message: `ERROR sending verification email: ${ex.message}`, status: 500, exception: ex});
            }
          } else {
            if (existingUser) {
              reject({
                message: `ERROR: user with name ${data.name} already exists with state ${existingUser.state}`,
                statusText: `User already exists`,
                status: 429
              });
            }
          }
        }).then(() => {
          res.status(200).end();
        }).catch(reason => {
          if (reason.exception) {
            if (reason.exception.responseCode === 501) {
              res.status(400); // bad request
              res.send(reason.exception.message);
              return;
            } else {
              console.error(reason.exception);
            }
          }
          if (reason.message) {
            console.log(reason.message);
          }
          res.status(reason.status ? reason.status : 500);
          if (reason.statusText) {
            res.send(reason.statusText);
          } else {
            res.end();
          }
        });
      } finally {
        u.unlock();
      }
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
      try {
        u.lock();
        new Promise(async (resolve, reject) => {

          let existingUser;
          try {
            existingUser = await u.getUserByName(data.name);
          } catch (ex) {
            reject({
              message: `ERROR while getting user with name ${data.name}: ${ex.message}`,
              status: 500,
              exception: ex
            });
            return;
          }
          if (existingUser) {
            let tokenData;
            try {
              tokenData = await u.verifyCodeAndCreateAccessTokenForUser(data.name, data.code);
            } catch (ex) {
              reject({status: 401, exception: ex});
              return;
            }
            if (tokenData) {
              tokenData.name = existingUser.name;
              if (existingUser.state === 'new') {
                existingUser.state = 'provisioned';
                existingUser.expiredAfter = moment().add(1, 'month');
                try {
                  await u.saveUser(existingUser);
                  resolve(tokenData);
                } catch (ex) {
                  reject({
                    message: `ERROR while saving user with name ${existingUser.name}: ${ex.message}`,
                    status: 500,
                    exception: ex
                  });
                }
              } else {
                resolve(tokenData);
              }
            } else {
              reject({status: 401});
            }
          } else {
            reject({status: 404, statusText: 'User unknown'});
          }

        }).then((tokenData) => {
          res.json(tokenData);
        }).catch(reason => {
          if (reason.exception) {
            console.error(reason.exception);
          }
          if (reason.message) {
            console.log(reason.message);
          }
          res.status(reason.status ? reason.status : 500);
          if (reason.statusText) {
            res.send(reason.statusText);
          } else {
            res.end();
          }
        });
      } finally {
        u.unlock();
      }
    } else {
      console.log('data or code missing in request body');
      res.status(400).end();
    }
  });

  router.options('/authwithtoken', CORS(corsOptions)); // enable pre-flight

  // perms needed: - , must be authenticated (usually with bearer token from settings.json)
  router.post('/authwithtoken', CORS(corsOptions), authenticate, function (req, res, next) {
    if (req.user) {
      let u = new Users({tokenLifetimeInMinutes: config.get('tokenLifetimeInMinutes')});
      const name = req.user.name;
      console.log(`authwithtoken for user ${name}`);
      u.createAccessTokenForUser(name)
      .then(result => {
        res.json(result);
      })
      .catch(reason => {
        console.error('creating access token failed: ', reason.message);
        res.status(reason.status ? reason.status : 500).end();
      });
    } else {
      res.status(403).send('Not authenticated');
    }
  });

  router.options('/usersecret', CORS(corsOptions)); // enable pre-flight

  // perms needed: -, name and email must fit, state must be 'new'
  router.get('/usersecret', CORS(corsOptions), function (req, res, next) {
    let name = req.query.name;
    let email = req.query.email;
    let token = req.query.token;
    if (name && email && token) {
      let u = new Users({tokenLifetimeInMinutes: config.get('tokenLifetimeInMinutes')});
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

  router.options('/token', CORS(corsOptions)); // enable pre-flight

  // refresh token -> must be logged in
  router.get('/token', CORS(corsOptions), authenticate, function (req, res, next) {
    if (req.user) {
      let u = new Users({tokenLifetimeInMinutes: config.get('tokenLifetimeInMinutes')});
      const name = req.user.name;
      u.refreshToken(name)
      .then(result => {
        res.json(result);
      })
      .catch(reason => {
        console.error('Refreshing access token failed: ', reason);
        res.status(reason.status ? reason.status : 500).end();
      });
    } else {
      res.status(403).send('Not authenticated');
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

  router.options('/users/key', CORS(corsOptions)); // enable pre-flight

  // check the passphrase for the own decryption key
  // perms needed: read
  router.get('/users/key', CORS(corsOptions), authenticate, Right('read'), function (req, res, next) {

    const username = req.user.name;
    const passphrase = req.headers.password;
    const keyName = req.headers.encryptionkeyname;
    const u = new Users();

    u.getPrivateKey(username, passphrase)
    .then(result => {
      const encryptionKeyName = result.encryptionKeyName;
      if (keyName === encryptionKeyName) {
        const pki = forge.pki;
        let keyBuf = Buffer.from(result.encryptedPrivateKey);
        const privateKey = pki.decryptRsaPrivateKey(keyBuf, result.passphrase);
        if (privateKey) {
          res.json({encryptionKeyName: result.encryptionKeyName});
        } else {
          res.status(403).send('Das Passwort ist falsch');
        }
      } else {
        res.status(404).send('Invalid keyname');
      }
    })
    .catch(reason => {
      res.status(500).end();
      console.log(`Exception while verifying password: ${reason}`);
    });
  });

  /* add a new encryption key, which replaces any current encryption key - this can be done only, if no RSA keypair has been generated already*/
  // perms needed: admin
  router.post('/users/key', CORS(corsOptions), authenticate, Right('admin'), function (req, res, next) {

    const name = req.user.name;
    const password = req.body.password;
    // todo: check password strength

    const u = new Users();
    u.createNewKeyPair(name, password)
    .then(result => {

      // save public key in settings.json - everyone can see it
      config.set('encryptionPublicKey', result.encryptionPublicKey);
      config.set('encryptionKeyName', result.encryptionKeyName);
      config.save(function (err) {
        if (err) {
          console.log(`Error saving RSA public key in config: ${err}`);
          res.status(500).send('Saving the new RSA public key failed');
        } else {
          console.log(`New RSA public key created by user ${name}`);
          res.json({encryptionKeyName: result.encryptionKeyName});
        }
      });
    })
    .catch(reason => {
      res.status(500).end();
      console.log(`Exception while creating RSA keypair: ${reason}`);
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
        let newUserData = _.pick(req.body, 'email', 'state', 'isAdmin', 'isGroupAdmin', 'canRead', 'canWrite', 'isAutologin');

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

  router.options('/user/:name/key', CORS(corsOptions)); // enable pre-flight

  /* sets the private decryption key for another user */
  /* body parameter that needs to be set:
   * password: password of secured private key of current authenticated user
   * encryptionKeyName: name of private key that should be set at the specified user
   * targetKeyPassword: password used to encrypt private key for /user/:name
   */
  // perms needed: admin
  router.post('/user/:name/key', CORS(corsOptions), authenticate, Right('admin'), function (req, res, next) {

    const sourceUsername = req.user.name;
    const sourcePrivateKeyPassword = req.body.password;
    const sourceKeyname = req.body.encryptionKeyName;
    const targetUsername = req.params.name;
    const targetPrivateKeyPassword = req.body.targetKeyPassword;

    const u = new Users();
    u.migratePrivateKey(sourceUsername, sourcePrivateKeyPassword, sourceKeyname, targetUsername, targetPrivateKeyPassword)
    .then(() => {
      res.json({encryptionKeyName: sourceKeyname});
    })
    .catch(reason => {
      res.status(500).end();
      console.log(`Exception while sharing private decryption key: ${reason}`);
    });
  });

  /* deletes the private decryption key for another user */
  /* header parameter to be set:
   * encryptionKeyName: name of private key that should be deleted from the specified user
   */
  // perms needed: admin
  router.delete('/user/:name/key', CORS(corsOptions), authenticate, Right('admin'), function (req, res, next) {

    const encryptionKeyName = req.headers.encryptionkeyname;
    const targetUsername = req.params.name;

    console.log(`Deleting decryption key ${encryptionKeyName} from user ${targetUsername} (requested by user ${req.user.name})`);

    const u = new Users();
    u.deletePrivateKey(targetUsername, encryptionKeyName)
    .then(() => {
      res.end();
    })
    .catch(reason => {
      res.status(500).end();
      console.log('Exception while deleting private decryption key.', reason);
    });
  });

  router.options('/groups', CORS(corsOptions)); // enable pre-flight

  // perms needed: isAdmin || isGroupAdmin
  router.get('/groups', CORS(corsOptions), authenticate, Right('admin', 'groupadmin'), function (req, res, next) {
    new Staff().getGroupsList()
    .then(groups => {
      res.json(groups);
    })
    .catch(reason => {
      console.log(`ERROR retrieving groups: ${reason}`);
      res.status(500).end();
    });
  });

  router.options('/groups/:id', CORS(corsOptions)); // enable pre-flight

  /* add a new group */
  // perms needed: write access or  bearerToken for write access (passed by firealarm)
  router.post('/groups', CORS(corsOptions), authenticate, Right('admin', 'groupadmin'), function (req, res, next) {

    if (!req.is('json')) {
      console.log("ERROR adding new group: request body must be json");
      res.status(500);
      res.send('Error while adding new group data');
      return;
    }
    const group = {
      id: req.body.id,
      description: req.body.description,
      responsibleEmail: req.body.responsibleEmail,
      senderEmail: req.body.senderEmail,
      senderSMS: req.body.senderSMS,
    };

    const staff = new Staff();
    if (staff.existsGroup(group.id)) {
      console.log("ERROR adding new group: group with id " + group.id + " already exists");
      res.status(400);
      res.send('Gruppe mit gleicher Id existiert bereits.');
      return;
    }
    staff.addGroup(group.id, group.description, group.responsibleEmail, group.senderEmail, group.senderSMS).then(addedGroup => {
      req.app.get('backupStaff')(staff); // backup staff
      res.json({
        id: addedGroup.id,
        description: addedGroup.description,
        responsibleEmail: addedGroup.responsibleEmail,
        senderEmail: addedGroup.senderEmail,
        senderSMS: addedGroup.senderSMS,
      });

      // notify all clients
      const wss = req.app.get('wss');
      if (wss) {
        wss.clients.forEach(function each(client) {
          if (client.readyState === WebSocket.OPEN) {
            console.log(`Sending push to client ${client._socket.remoteAddress}`);
            client.send(`newGroup:${addedGroup.id}`);
          }
        });
      }
    }).catch(reason => {
      console.log("ERROR adding new group: ", reason);
      res.status(500);
      res.send('Error while adding new group data');
    });

  });

  /* update a group */
  // perms needed: isAdmin or isGrupAdmin
  router.put('/groups/:id', CORS(corsOptions), authenticate, Right('admin', 'groupadmin'), function (req, res, next) {
    const id = req.params.id;
    let staff = new Staff();
    staff.getGroups()
    .then(groups => {
      let group = groups[id];
      if (group) {

        let newGroupData = _.pick(req.body, 'id', 'description', 'responsibleEmail', 'senderEmail', 'senderSMS');

        let updateGroup = _.extend(group, newGroupData);

        staff.saveGroup(updateGroup)
        .then(savedGroup => {
          res.json(savedGroup);
        })
        .catch(reason => {
          console.log(`ERROR retrieving group with id ${id}: ${reason}`);
          res.status(500).end();
        });
      } else {
        res.status(404).end();
      }
    })
    .catch(reason => {
      console.log(`ERROR retrieving group with id ${id}: ${reason}`);
      res.status(500).end();
    });
  });

  /* delete a group */
  // perms needed: isAdmin
  router.delete('/groups/:id', CORS(corsOptions), authenticate, Right('admin', 'groupadmin'), function (req, res, next) {
    const id = req.params.id;
    let staff = new Staff();
    staff.getGroups()
    .then(groups => {
      if (groups[id]) {
        staff.deleteGroup(id)
        .then(() => {
          res.end();
        })
        .catch(reason => {
          console.log(`ERROR deleting Group with id ${id}: ${reason}`);
          res.status(500).end();
        });
      } else {
        res.status(404).end();
      }
    })
    .catch(reason => {
      console.log(`ERROR reading groups: ${reason}`);
      res.status(500).end();
    });
  });


  router.options('/members', CORS(corsOptions)); // enable pre-flight

  // perms needed: isAdmin || isGroupAdmin
  router.get('/members', CORS(corsOptions), authenticate, Right('admin', 'groupadmin'), function (req, res, next) {
    new Staff().getMembersList()
    .then(members => {
      res.json(members);
    })
    .catch(reason => {
      console.log(`ERROR retrieving members: ${reason}`);
      res.status(500).end();
    });
  });

  router.options('/members/:id', CORS(corsOptions)); // enable pre-flight

  /* add one or multiple new member */
  // perms needed: isAdmin || isGroupAdmin
  router.post('/members', CORS(corsOptions), authenticate, Right('admin', 'groupadmin'), function (req, res, next) {

    if (!req.is('json')) {
      console.log("ERROR adding new member: request body must be json");
      res.status(500);
      res.send('Error while adding new member data');
      return;
    }
    const members = req.body.members;
    if (_.isArray(members)) {
      const staff = new Staff();
      staff.addMembers(members).then(addedMembers => {
        req.app.get('backupStaff')(staff); // backup staff
        res.json(addedMembers);

        // notify all clients
        const wss = req.app.get('wss');
        if (wss) {
          wss.clients.forEach(function each(client) {
            if (client.readyState === WebSocket.OPEN) {
              console.log(`Sending push to client ${client._socket.remoteAddress}`);
              const memberIds = _.map(addedMembers, member => {
                return member.id;
              })
              client.send(`newMembers:${JSON.stringify(memberIds)}`);
            }
          });
        }
      }).catch(reason => {
        console.log("ERROR adding new member: ", reason);
        res.status(500);
        res.send('Error while adding new member data');
      });

    } else {
      res.status(500);
      res.send('Error while adding new member data. Must be array.');
    }

  });

  /* update a member */
  // perms needed: isAdmin || isGroupAdmin
  router.put('/members/:id', CORS(corsOptions), authenticate, Right('admin', 'groupadmin'), function (req, res, next) {
    const id = req.params.id;
    let staff = new Staff();
    staff.getMembers()
    .then(members => {
      let member = members[id];
      if (member) {

        let newMemberData = _.pick(req.body, 'id', 'lastname', 'firstname', 'mobile', 'email');
        let updateMember = _.extend(member, newMemberData);

        staff.saveMember(updateMember)
        .then(savedMember => {
          res.json(savedMember);
        })
        .catch(reason => {
          console.log(`ERROR retrieving member with id ${id}: ${reason}`);
          res.status(500).end();
        });
      } else {
        res.status(404).end();
      }
    })
    .catch(reason => {
      console.log(`ERROR retrieving member with id ${id}: ${reason}`);
      res.status(500).end();
    });
  });

  /* delete a member */
  // perms needed: isAdmin || isGroupAdmin
  router.delete('/members/:id', CORS(corsOptions), authenticate, Right('admin', 'groupadmin'), function (req, res, next) {
    const id = req.params.id;
    let staff = new Staff();
    staff.getGroups()
    .then(groups => {
      if (groups[id]) {
        staff.deleteGroup(id)
        .then(() => {
          res.end();
        })
        .catch(reason => {
          console.log(`ERROR deleting Group with id ${id}: ${reason}`);
          res.status(500).end();
        });
      } else {
        res.status(404).end();
      }
    })
    .catch(reason => {
      console.log(`ERROR reading groups: ${reason}`);
      res.status(500).end();
    });
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

  return router;
};
