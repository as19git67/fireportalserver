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
const QRCode = require('qrcode');

router.options('/jobs', CORS()); // enable pre-flight

/* get all jobs */
router.get('/jobs', CORS(), function (req, res, next) {
  new Jobs().getAll(function (err, jobs) {
    if (err) {
      console.log("ERROR getting jobs: ", err);
      res.status(500).end();
    } else {
      res.json(jobs);
    }
  });
});

/* update a job */
router.put('/jobs/:id', CORS(), function (req, res, next) {
  if (isNaN(req.params.id)) {
    res.status(403);
    res.end();
  } else {
    // complete req.body is the job object
    if (req.body) {
      new Jobs().saveJob(req.body, function (err, updatedJob) {
        if (err) {
          console.log("ERROR saving job: ", err);
          res.status(500);
          res.send('Error while saving job data');
        } else {
          res.json(updatedJob);
        }
      });
    } else {
      res.status(400);
      res.end();
    }
  }
});

/* delete a job */
router.delete('/jobs/:id', CORS(), function (req, res, next) {
  if (isNaN(req.params.id)) {
    res.status(403);
    res.end();
  } else {
    new Jobs().deleteJob(req.params.id, function (err) {
      if (err) {
        console.log(`ERROR deleting job with id: ${req.params.id}: ${err}`);
        res.status(500);
        res.send('Error deleting job data');
      } else {
        res.end();
      }
    });
  }
});

/* add a new job */
router.post('/jobs', CORS(), function (req, res, next) {
  // complete req.body is the job object
  if (req.body) {
    new Jobs().addJob(req.body, function (err, addedJob) {
      if (err) {
        console.log("ERROR adding new job: ", err);
        res.status(500);
        res.send('Error while adding new job data');
      } else {
        res.json(addedJob);
      }
    });
  } else {
    res.status(400);
    res.end();
  }
});

router.options('/verifyemail', CORS()); // enable pre-flight

router.post('/verifyemail', CORS(), function (req, res, next) {
  let data = req.body;
  if (_.isString(data['email']) && _.isString(data['name'])) {
    // console.log(JSON.stringify(data, null, 2));
    let u = new Users();
    u.getUserByName(data.name).then(existingUser => {
      if (existingUser === undefined || (existingUser && existingUser.state === 'new')) {
        u.createUser(data.name, data.email).then(user => {
          // console.log("New user: " + JSON.stringify(user, null, 2));
          _sendVerificationEmail(data.email, `${req.headers.origin}/#/setupauth3?name=${data.name}&email=${data.email}`)
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

router.options('/verifycode', CORS()); // enable pre-flight

router.post('/verifycode', CORS(), function (req, res, next) {
  let data = req.body;
  if (_.isString(data['code']) && _.isString(data['name'])) {
    let u = new Users();
    u.getUserByName(data.name).then(existingUser => {
      if (existingUser) {
        u.verifyCode(data.name, data.code)
            .then(() => {
              // todo: if user.state === 'new' -> user.state = 'provisioned'
              res.status(200).end();
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

router.options('/usersecret', CORS()); // enable pre-flight

router.get('/usersecret', CORS(), function (req, res, next) {
  let name = req.query.name;
  let email = req.query.email;
  if (name && email) {
    let u = new Users();
    u.getUserByName(name).then(user => {
      if (user) {
        if (email === user.email && user.state === 'new') {
          u.getUserSecretByName(name, req.app.get('appName'))
              .then(secret => {
                res.json(JSON.stringify(secret));
              })
              .catch(reason => {
                console.log(`ERROR retrieving user secret for ${name}: ${reason}`);
                res.status(500).end();
              });
        } else {
          res.status(401).end();
        }
      } else {
        res.status(404).end();
      }
    }).catch(reason => {
      console.log(`ERROR retrieving user information for ${name}: ${reason}`);
      res.status(500).end();
    });
  } else {
    res.status(400).send('Missing parameters');
  }
});

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
