const faker = require('faker');
const mongoose = require('mongoose');
const moment = require('moment');

// Creates database if it can't find it or uses it if it already exists
mongoose.connect('mongodb://localhost/users')

const usersSchema = mongoose.Schema({
	_id: String,
	steps: Array,
	fullName: String
})

var User = mongoose.model('User', usersSchema)

var count = 10

for (let i = 0; i < 10; i++) {

    let today = moment();

    dates = []

    for (let j = 0; j < 30; j++) {
        dates.push(today.format('YYYY-MM-DD'));
        today = today.subtract(1, 'days')
    }

    steps = dates.map(date => ({ dateTime: date, value: Math.floor(Math.random() * 5000 + 1000) }))
    
    u = new User({
        _id: count,
        steps: steps,
        fullName: faker.name.findName(),
    })

    u.save((err, user) => {
        if (err) {
            console.log('Something went wrong');
            console.log(err)
        } else {
            console.log('We just saved a user');
            console.log(user);
        }
    })

    count++;
}