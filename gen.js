const faker = require('faker');
const mongoose = require('mongoose');

// Creates database if it can't find it or uses it if it already exists
mongoose.connect('mongodb://localhost/users')

const usersSchema = mongoose.Schema({
	_id: String,
	steps: Number,
	startTime: String,
	fullName: String
})

var User = mongoose.model('User', usersSchema)

var count = 10

for (i = 0; i < 10; i++) {
    var date = new Date();
    var dateISOString = date.toISOString();
    
    u = new User({
        _id: count,
        steps: Math.floor(Math.random() * 6000 + 3000),
        startTime: dateISOString,
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
 