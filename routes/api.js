const fs = require('fs');
const path = require('path');
const express = require('express');
const passport = require('passport');
const router = express.Router();
const _ = require('underscore');
const config = require('../config');
const moment = require('moment');

router.post('/verfycode', passport.authenticate('bearer', {session: false}), function (req, res, next) {

  res.status(400).end();
});

module.exports = router;
