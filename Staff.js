const fs = require('fs');
const path = require('path');
const jf = require('jsonfile');
const _ = require('underscore');
const moment = require('moment');
const config = require('./config');
const zlib = require('zlib');

const staffDataFilename = 'staff.json';
let staffDataFileLocked = false;

function _unlockStaffDataFile() {
  staffDataFileLocked = false;
}

_unlockStaffDataFile();

let Staff = module.exports = function (options) {
  options || (options = {});
  this.filename = staffDataFilename;

  this.initialize.apply(this, arguments);
};

_.extend(Staff.prototype, {
  initialize: function () {
    this._locked = false;
  },

  lock: async function () {
    const self = this;
    // wait for any existing _flock based lock has been released
    await new Promise((resolve, reject) => {
      self._flock(resolve, reject);
    });
    this._locked = true;
  },

  unlock: function () {
    this._locked = false;
    _unlockStaffDataFile();
  },

  // the lock function must be a recursive timer
  _flock: function (resolve, reject) {
    // check if already locked with explicit lock function
    if (this._locked) {
      // console.log('Skip locking with _flock, because already locked by lock()');
      resolve();
      return;
    }
    const self = this;
    if (staffDataFileLocked) {
      console.log(staffDataFilename + ' is locked. Trying again later...');
      setTimeout(() => {
        self._flock(resolve, reject);
      }, 250);
    } else {
      staffDataFileLocked = true;
      resolve();
    }
  },

  _funlock: function () {
    // ignore unlock if explicitly locked by calling lock()
    if (!this._locked) {
      _unlockStaffDataFile();
    } else {
      // console.log('Skip unlocking with _unlockStaffDataFile, because expecting to unlock with unlock()');
    }
  },

  _initFile: async function () {
    const self = this;
    return new Promise((resolve, reject) => {
      fs.exists(this.filename, function (exists) {
        if (!exists) {
          let data = {groups: {}, members: {}, staff: {}};
          jf.writeFile(self.filename, data, function (err) {
            if (err) {
              reject(err);
            } else {
              resolve(data);
            }
          });

        } else {
          new Promise((resolve, reject) => {
            self._flock(resolve, reject);
          })
          .then(() => {
            jf.readFile(self.filename, function (err, data) {
              if (err) {
                reject(err);
              } else {
                if (!data.groups) {
                  data.groups = {};
                }
                if (!data.staff) {
                  data.staff = {};
                }
                resolve(data);
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

  _addGroup: async function (id, name, description, responsibleEmail) {
    try {
      console.log(`_addGroup: _initFile`);
      let data = await this._initFile();

      if (data.groups[id]) {
        throw new Error(`Group with id ${id} already exists`);
      }
      const group = {
        id: id,
        name: name,
        description: description,
        responsibleEmail: responsibleEmail
      };

      data.groups[id] = group;

      const filename = this.filename;
      const addedGroup = await new Promise((resolve, reject) => {
        jf.writeFile(filename, data, {spaces: 2})
        .then(() => {
          console.log(`_addGroup: ${filename} written`);
          resolve(group);
        })
        .catch(reason => {
          console.log(`_addGroup: error writing ${filename}`);
          reject(reason);
        });
        console.log(`_addGroup: started writing ${filename}`);
      });
      console.log(`_addGroup: returning added group`);
      return addedGroup;
    } finally {
      console.log(`_addGroup: unlocking - finally`);
      this._funlock();
    }
  },

  /* adds a new group */
  addGroup: async function (id, name, description, responsibleEmail) {
    if (id && name) {
      let addedGroup = await this._addGroup(id, name, description, responsibleEmail);
      return addedGroup;
    } else {
      throw new Error("group id or name is undefined");
    }
  },

  /* updates group information */
  saveGroup: async function (group) {
    if (group.id === undefined) {
      const err = "ERROR: attempt to save group without id";
      console.log(err);
      throw new Error(err);
    }
    try {
      // console.log(`saveGroup: _initFile`);
      let data = await this._initFile();

      if (data.groups[group.id]) {
        _.extend(data.groups[group.id], _.pick(group, 'name', 'description', 'responsibleEmail'));
        const filename = this.filename;
        let savedGroup = await new Promise((resolve, reject) => {
          jf.writeFile(filename, data, {spaces: 2})
          .then(() => {
            console.log(`saveGroup: ${filename} written`);
            resolve(data.groups[group.id]);
          })
          .catch(reason => {
            console.log(`saveGroup: error writing ${filename}`);
            reject(reason);
          });
          // console.log(`saveGroup: started writing ${filename}...`);
        });
        // console.log(`saveGroup: returning saved group`);
        return savedGroup;
      } else {
        throw new Error("Group does not exist");
      }
    } finally {
      // console.log("saveGroup: unlocking in finally");
      this._funlock();
    }
  },

  deleteGroup: async function (groupId) {
    if (groupId === undefined) {
      const err = "ERROR: attempt to delete group with undefined id";
      console.log(err);
      throw new Error(err);
    }
    if (!_.isString(groupId)) {
      groupId = groupId.toString();
    }
    try {
      console.log(`deleteGroup: _initFile`);
      let data = await this._initFile();
      delete data.groups[groupId];
      const filename = this.filename;
      const id = await new Promise((resolve, reject) => {
        jf.writeFile(filename, data, {spaces: 2})
        .then(() => {
          console.log(`deleteGroup: ${filename} written`);
          resolve(groupId);
        })
        .catch(reason => {
          console.log(`deleteGroup: error writing ${filename}`);
          reject(reason);
        });
        console.log(`deleteGroup: started writing ${filename}...`);
      });
      console.log(`deleteGroup: returning id ${id}`);
      return id;
    } finally {
      console.log("deleteGroup: unlocking in finally");
      this._funlock();
    }
  },

  getGroups: async function () {
    try {
      // console.log(`getGroups: _initFile`);
      let data = await this._initFile();
      if (data && data.groups) {
        return data.groups;
      } else {
        return [];
      }
    } finally {
      // console.log(`getGroups: unlocking - finally`);
      this._funlock();
    }
  },

  getGroupsList: async function () {
    try {
      // console.log(`getGroups: _initFile`);
      let data = await this._initFile();
      if (data && data.groups) {
        const groups = _.map(data.groups, (group) => {
          return group;
        });
        return groups;
      } else {
        return [];
      }
    } finally {
      // console.log(`getGroups: unlocking - finally`);
      this._funlock();
    }
  },

  getAll: async function (groupId) {
    try {
      // console.log(`getAll: _initFile`);
      let data = await this._initFile();
      if (data && data.staff && _.isArray(data.staff)) {

        let allOfGroup = _.where(data.staff, {groupId: groupId});
        let sortedStaff = _.sortBy(allOfGroup, function (person) {
          return person.lastname + person.firstname;
        });

        return _.map(sortedStaff, function (person) {
          return {
            id: person.id,
            lastname: person.lastname,
            firstname: person.firstname
          };
        });
      } else {
        return [];
      }
    } finally {
      // console.log(`getAll: unlocking - finally`);
      this._funlock();
    }
  },

  getMembers: async function () {
    try {
      // console.log(`getMembers: _initFile`);
      let data = await this._initFile();
      if (data && data.members) {
        return data.members;
      } else {
        return {};
      }
    } finally {
      // console.log(`getMembers: unlocking - finally`);
      this._funlock();
    }
  },

  getMembersList: async function () {
    try {
      // console.log(`getMembersList: _initFile`);
      let data = await this._initFile();
      if (data && data.members) {
        const members = _.map(data.members, (member) => {
          return member;
        });
        return members;
      } else {
        return [];
      }
    } finally {
      // console.log(`getMembersList: unlocking - finally`);
      this._funlock();
    }
  },

  getAllMembersByGroupId: async function (groupId) {
    try {
      // console.log(`getAllMembersByGroupId: _initFile`);
      let data = await this._initFile();
      let members = [];
      if (data && data.members) {
        const memberIds = Object.keys(data.members);
        for (let i = 0; i < memberIds.length; i++) {
          const memberId = memberIds[i];
          const member = data.members[memberId];
          if (_.isArray(member.groups)) {
            for (let j = 0; j < member.groups.length; j++) {
              const group = member.groups[j];
              if (group.id === groupId) {
                members.push(member);
                break;
              }
            }
          }
        }
        const sortedMembers = _.sortBy(members, function (member) {
          return member.lastname + member.firstname;
        });
        return sortedMembers;
      } else {
        return [];
      }
    } finally {
      // console.log(`getAll: unlocking - finally`);
      this._funlock();
    }
  },

  _addMember: async function (id, lastname, firstname, mobile, email) {
    try {
      console.log(`_addMember: _initFile`);
      let data = await this._initFile();

      if (data.members[id]) {
        throw new Error(`Member with id ${id} already exists`);
      }
      const member = {
        id: id,
        lastname: lastname,
        firstname: firstname,
        mobile: mobile,
        email: email
      };

      data.members[id] = member;

      const filename = this.filename;
      const addedMember = await new Promise((resolve, reject) => {
        jf.writeFile(filename, data, {spaces: 2})
        .then(() => {
          console.log(`_addMember: ${filename} written`);
          resolve(member);
        })
        .catch(reason => {
          console.log(`_addMember: error writing ${filename}`);
          reject(reason);
        });
        console.log(`_addMember: started writing ${filename}`);
      });
      console.log(`_addMember: returning added member`);
      return addedMember;
    } finally {
      console.log(`_addMember: unlocking - finally`);
      this._funlock();
    }
  },

  /* adds a new member */
  addMember: async function (id, lastname, firstname, mobile, email) {
    if (id && lastname && firstname) {
      let addedMember = await this._addMember(id, lastname, firstname, mobile, email);
      return addedMember;
    } else {
      throw new Error("member id, lastname or firstname is undefined");
    }
  },

  /* updates member information */
  saveMember: async function (member) {
    if (member.id === undefined) {
      const err = "ERROR: attempt to save member without id";
      console.log(err);
      throw new Error(err);
    }
    try {
      // console.log(`saveMember: _initFile`);
      let data = await this._initFile();

      if (data.members[member.id]) {
        _.extend(data.members[member.id], _.pick(member, 'lastname', 'firstname', 'mobile', 'email'));
        const filename = this.filename;
        let savedMember = await new Promise((resolve, reject) => {
          jf.writeFile(filename, data, {spaces: 2})
          .then(() => {
            console.log(`saveMember: ${filename} written`);
            resolve(data.members[member.id]);
          })
          .catch(reason => {
            console.log(`saveMember: error writing ${filename}`);
            reject(reason);
          });
          // console.log(`saveMember: started writing ${filename}...`);
        });
        // console.log(`saveMember: returning saved member`);
        return savedMember;
      } else {
        throw new Error("Member does not exist");
      }
    } finally {
      // console.log("saveMember: unlocking in finally");
      this._funlock();
    }
  },

  deleteMember: async function (memberId) {
    if (memberId === undefined) {
      const err = "ERROR: attempt to delete member with undefined id";
      console.log(err);
      throw new Error(err);
    }
    if (!_.isString(memberId)) {
      memberId = memberId.toString();
    }
    try {
      console.log(`deleteMember: _initFile`);
      let data = await this._initFile();
      delete data.members[memberId];
      const filename = this.filename;
      const id = await new Promise((resolve, reject) => {
        jf.writeFile(filename, data, {spaces: 2})
        .then(() => {
          console.log(`deleteMember: ${filename} written`);
          resolve(memberId);
        })
        .catch(reason => {
          console.log(`deleteMember: error writing ${filename}`);
          reject(reason);
        });
        console.log(`deleteMember: started writing ${filename}...`);
      });
      console.log(`deleteMember: returning id ${id}`);
      return id;
    } finally {
      console.log("deleteMember: unlocking in finally");
      this._funlock();
    }
  },

  backupStaff: async function () {
    const staffBackupPath = config.get('staffBackupPath');
    const filename = path.join(staffBackupPath, `staff.backup.${moment().format('YYYY-MM-DD__HH.mm.ss')}.json.gz`);
    console.log(`Staff backup started. Backup file is ${filename}`);
    try {
      // console.log(`backupStaff: _initFile`);
      const data = await this._initFile();
      const compressedStaff = await new Promise((resolve, reject) => {
        console.log('compressing backup...');
        zlib.gzip(data, (err, buffer) => {
          if (err) {
            reject(err);
          } else {
            resolve(buffer);
          }
        });
      });

      await new Promise((resolve, reject) => {
        fs.writeFile(filename, compressedStaff, 'binary', err => {
          if (err) {
            reject(err);
          } else {
            console.log(`Backup of staff data written to ${filename} as gzip compressed file.`);
            resolve();
          }
        });
      });
    } catch (ex) {
      console.log(`EXCEPTION while backing up staff: ${ex}`);
    } finally {
      // console.log("backupStaff: unlocking in finally");
      this._funlock();
    }
  },

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

Staff.extend = extend;
