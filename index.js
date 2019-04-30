// server requirements
const express = require('express'),
    http = require('http'),
    app = express(),
    server = http.createServer(app),
    io = require('socket.io').listen(server);

// tools for geospacial functions
var turf = require('@turf/turf')
var polyline = require('@mapbox/polyline')

// weather data connection
var weather = require('./weatherparser.js')

/*
*********************************************************
                    Server Settings
*********************************************************
*/

// output server actions to console
const consoleOutput = false

// set to true if server will be on heroku
const onHeroku = true

// set up active game time for server
var activeGameTime = true

// hour the app becomes playable
const dayBegin = 10

// the last hour the app is playable in a day
// ex. 23 = 11pm, makes game shuts down at midnight
const dayEnd = 23

// how many minutes between getting weather updates
const weatherTiming = 5

// how often should the server update a players current position and check for scores
// currently every one second
const gameTiming = 1000

// ****************
//  Score Settings
// ****************

// how often should a player score points
// currently set at 5 minutes
const scoreTiming = 5000 * 60

// score values for all storm types
const tornWarnScore = 20
const tornWatchScore = 15
const tsWarnScore = 10
const tsWatchScore = 5
const wind1 = 5
const wind5 = 2
const torn1 = 50
const torn5 = 25
const hailsmall1 = 5
const hailsmall5 = 2
const hail1inch1 = 10
const hail1inch5 = 4
const hail2inch1 = 15
const hail2inch5 = 8
const hail3inch1 = 20
const hail3inch5 = 10

/*
*********************************************************
                End Server Settings
*********************************************************
*/

var serverStartTime = new Date().getTime()

// get fresh weather data
var storms = weather.parse()

var tornadoWarn = []
var tornadoWatch = []
var tStormWarn = []
var tStormWatch = []
var wind = []
var tornado = []
var hail = []

setTimeout(() => { fillStormArrays(); if(consoleOutput){ console.log(storms) } }, 5000)


// start up server listening on chosen port
// takes either assigned heroku port, or port 3000 if testing locally
const port = (process.env.PORT || 3000)

app.get('/', (req, res) => {
    res.send('Server is running on port ' + port)
});

server.listen(port, () => {
    console.log('Node app is running on port ' + port)
});

// a list of all players who have logged in at one point through the day.
// they stay in this list until end of day
var activePlayers = []

// list of players currently logged in
var loggedinPlayers = []

var emittedEndOfDay = false

startGameTimer()

//start gameplay, should run until end of day
gameLoop()

/* 
*****************************************************************************
                            Socket Connection
*****************************************************************************
*/


io.on('connection', (socket) => {

    if(consoleOutput){ console.log("a user has connected...") }

    // logs connected user into an account stored on the phone, allows them to retrieve updated data throughout the day
    socket.on('login', (username, pass, cScore, tScore, sMultiplyer) => {

        if (socket.player == null) {
            var success = false

            // check if player was previously loggedin and in active list
            for (var i = 0; i < activePlayers.length; i++) {

                var player = activePlayers[i]

                if (player.name == username && player.passkey == pass) {

                    socket.player = player
                    loggedinPlayers.push(socket.player)
                    socket.join("loggedin")
                    socket.player.isLoggedIn = true
                    socket.player.socket = socket
                    success = true

                    socket.emit("loginFromPrevious", 
                        {
                            "dailyScore": player.currentScore, 
                            "totalScore": player.totalScore, 
                            "currentLon": player.currentLocation.geometry.coordinates[0],
                            "currentLat": player.currentLocation.geometry.coordinates[1],
                            "routeGeometry": player.routeGeometry,
                            "destLon": player.destination.geometry.coordinates[0],
                            "destLat": player.destination.geometry.coordinates[1],
                            "isTraveling": player.isTraveling 
                        })
                    if (!activeGameTime) {
                        if(consoleOutput){ console.log("emitting endOfDay to " + socket.player.name) }
                        socket.emit("endOfDay")
                    }
                    if(consoleOutput){ console.log(player.name + " has logged back in from previous session.") }
                    break
                }
            }
            // if player profile not found in active list, create new player and use passed values
            if (!success) {

                socket.player = new Player(socket= socket,
                                            name= username,
                                            passkey= pass,
                                            currentScore= cScore,
                                            totalScore= tScore,
                                            scoreMultiplyer= sMultiplyer,
                                            isTraveling= false,
                                            currentLocation= null,
                                            destination= null,
                                            route= null,
                                            routeGeometry= null)

                loggedinPlayers.push(socket.player)
                socket.join("loggedin")
                socket.player.isLoggedIn = true

                socket.emit("loginSuccess")

                if (!activeGameTime) {
                    if(consoleOutput){ console.log("emitting endOfDay to " + socket.player.name) }
                    socket.emit("endOfDay")
                }
                if(consoleOutput){ console.log(socket.player.name + " has logged in for the first time today") }
            }
        }
        else {
            socket.emit('errorMessage', { "errorMessage": "Error on emit('login'): attempting to log into an account while already logged in" })
        }    
    })

    // untie player profile from socket and remove from logged in list, 
    // allowing player to relog in or log into a new account without needing to exit the App
    socket.on('logoff', () => {

        if(socket.player != null) {

            loggedinPlayers.splice(loggedinPlayers.indexOf(socket.player), 1)
            socket.leave("loggedin")
            socket.player.isLoggedIn = false
            if(consoleOutput){ console.log(socket.player.name + " logged off...") }
            socket.player.socket = null
            socket.player = null
        }
        else {
            // emit error can't log out when not logged in
            socket.emit('errorMessage', { "errorMessage": "Error on emit('logoff'): Player was not logged in. Must be logged in to log off." })
        }
    })

    // remove socketid Player, and remove from loggedinPlayers list
    socket.on('disconnect', () => {
        // if the use was logged in when disconnected
        if (socket.player != null) {

            if(consoleOutput){ console.log(socket.player.name + " disconnected...") }
            loggedinPlayers.splice(loggedinPlayers.indexOf(socket.player), 1)
            socket.leave("loggedin")
            socket.player.isLoggedIn = false
            socket.player.socket = null
            socket.player = null
        }
        else { 
            if(consoleOutput){ console.log("a user has disconnected...") }
        }
    })

    socket.on('startLocationSelect', (long, lat, scoreMultiplyer) => {

        if(activePlayers.includes(socket.player) == false) {

            socket.player.currentLocation = turf.point([parseFloat(long), parseFloat(lat)])
            socket.player.scoreMultiplyer = scoreMultiplyer
            // only add player to active players list once their start location is confirmed by the app
            activePlayers.push(socket.player)
            if(consoleOutput){ console.log(socket.player.name + " has chosen a start location at " + socket.player.currentLocation.geometry.coordinates) }
        }
        else {
            // emit error cannot select start location for active player
            socket.emit('errorMessage', { "errorMessage": "Error on emit('startLocationSelect'): Player has already selected start location for the day." })
        }
    })

    // geometry is an encoded polyline, distance meters, duration in seconds
    socket.on('setTravelRoute', (geometry, distance, duration, destLong, destLat) => {

        if (activePlayers.includes(socket.player)) {
            if (socket.player.isTraveling == false) {

                var geo = polyline.toGeoJSON(geometry, 6)
                // have the start of the route be the player's current location
                geo.coordinates.unshift(socket.player.currentLocation.geometry.coordinates)

                dest = turf.point( [parseFloat(destLong), parseFloat(destLat)] )
                // have the end of route be the destination point if not equal to the last coord
                if (turf.point(geo.coordinates[geo.coordinates.length -1]) != dest) {
                    geo.coordinates.push( dest.geometry.coordinates )
                }

                var route = turf.lineString(geo.coordinates)
                // km/s
                var speed = (distance / 1000) / duration

                socket.player.destination = dest
                socket.player.routeGeometry = geometry
                socket.player.route = route
                socket.player.speed = speed
                socket.player.startTime = new Date().getTime()
                socket.player.isTraveling = true
                socket.player.duration = duration
                if(consoleOutput){ console.log(socket.player.name + " traveling from " + socket.player.currentLocation.geometry.coordinates + " to " + socket.player.destination.geometry.coordinates + " for " + duration / 60 + " minutes") }
            }
            else {
                // emit error cannot set travel route while player is currently traveling, emit stop travel before setting new route
                socket.emit('errorMessage', { "errorMessage": "Error on emit('setTravelRoute'): Player is currently traveling. Must emit('stopTravel') before selecting a new route." })
            }
        }
        else {
            // emit cannot set travel route before chosing a start location with startLocationSelect
            socket.emit('errorMessage', { "errorMessage": "Error on emit('setTravelRoute'): Player must choose a starting location before creating a travel route. Send the start location to the server with emit('startLocationSelect', lon, lat, scoreMultiplier)" })
        }
    })

    socket.on('stopTravel', () => {
        if(socket.player.isTraveling) {
            socket.player.isTraveling = false
            if(consoleOutput){ console.log(socket.player.name + " stopping travel at " + socket.player.currentLocation.geometry.coordinates) }
        }
        else {
            // error requested stop travel when player was not traveling
            socket.emit('errorMessage', { "errorMessage": "Error on emit('stopTravel'): Player was not traveling." })
        }
    })

    socket.on('getPlayerUpdate', () => {
        if (activePlayers.includes(socket.player)) {
            var timeleft = 0

            if (socket.player.isTraveling) {
                var start = socket.player.startTime
                var now = new Date().getTime()
                timeleft = socket.player.duration - ((now - start) / 1000)
            }
            socket.emit('updatePlayer', {
                "currentLocation": socket.player.currentLocation.geometry.coordinates,
                "currentScore": socket.player.currentScore,
                "totalScore": socket.player.totalScore,
                "timeLeft": timeleft
            })
        }
        else {
            socket.emit('errorMessage', { "errorMessage": "Error on emit('getPlayerUpdate'): Player is not yet active. Select a starting position first."})
        }
    })

    socket.on("getWeatherUpdate", () => {

        var now = new Date()
        // delay sending weather data if it is still getting parsed
        if (now.getMinutes() % weatherTiming == 0 && now.getSeconds() < 5) {
            setTimeout(() => { socket.emit("weatherUpdate", formatWeather()) }, 5000)
        }
        else {
            socket.emit("weatherUpdate", formatWeather())
        } 
        if(consoleOutput){ console.log("sent user weather") }
    })
    
    // tell app if game is in playable hours, tell number of seconds until it is playable if not
    socket.on("getGameHours", () => {
        var secleft = 0
        if(!activeGameTime) {
            var now = new Date()
            var open = new Date()

            open.setMinutes(0)
            open.setSeconds(0)
            open.setMilliseconds(0)
            // if server shuts down before midnight
            if (now.getHours() > dayBegin) {
                open.setDate(now.getDate()+1)
            }
            open.setHours(dayBegin)
            open.setMinutes(0)
            open.setSeconds(0)
            open.setMilliseconds(0)
            var msUntilOpen = open.getTime() - now.getTime()
            secleft = ~~( msUntilOpen / 1000)
        }

        socket.emit("gameHours", {
            "isActiveHours": activeGameTime,
            "startTime": dayBegin,
            "timeUntilOpen": secleft
        })
    })
});


/*
*****************************************************************************
                                Gameplay
*****************************************************************************
*/

function Player(socket, name, passkey, currentScore, totalScore, scoreMultiplyer, isTraveling, currentLocation, destination, route, routeGeometry) {
    this.socket = socket;
    this.name = name;
    this.passkey = passkey
    this.currentScore = currentScore;
    this.totalScore = totalScore;
    this.isTraveling = isTraveling;
    this.inStorm = false;
    this.isLoggedIn = true;
    this.currentLocation = currentLocation;
    this.destination = destination;
    this.route = route;
    this.routeGeometry = routeGeometry;
    this.startTime = null;
    this.speed = 0;
    this.duration = 0;
    this.scoreMultiplyer = scoreMultiplyer;
    this.stormsInside = [];
    this.pointNearChecked = [];
}

// create a timer that checks the time every minute and grabs updated weather every X minutes while in active game time
function startGameTimer() {

    // get the current time and see if its in active time
    var d = new Date()
    checkGameTime(d)
    if(consoleOutput){ console.log("active game time is " + activeGameTime) }
    var intervalId = setInterval(runGameClock, 60 * 1000 - d.getSeconds() * 1000)

    function runGameClock() {
        var d = new Date()
        if(consoleOutput){ console.log("Time is " + d.getHours() + ":" + d.getMinutes() + ":" + d.getSeconds()) }
        checkGameTime(d)

        if (activeGameTime) {
            // update weather every X minutes
            // since server gets weather data on start up, skip weather update for at least a minute after
            // to prevent parser error
            if (d.getMinutes() % weatherTiming == 0 && d.getTime() - serverStartTime > 60000) {
                if(consoleOutput){ console.log("updating weather...") }
                storms = weather.parse()
                // wait 5 seconds to push weather to players since I can't figure out await/promise
                setTimeout(() => {
                    if(consoleOutput){ console.log(storms) }
                    if(stormsHaveChanged()) {
                        fillStormArrays()
                         // send weather update to all players currently logged in
                        io.in("loggedin").emit("weatherUpdate", formatWeather())
                        if(consoleOutput){ console.log("sent updated weather to all logged in players.") }
                        // ping self every 5 minutes to keep server awake during game time on heroku
                        if(onHeroku){ http.get("http://armchairstormchasing.herokuapp.com") }
                    }  
                }, 5000)
            }
        }
        else {
            if(emittedEndOfDay == false) {
                emittedEndOfDay = true
                // only emit end of day if server wasn't started up in end of day state
                // as users are sent end of day on login in this situation
                // done by checking if server has been up for than two minutes before emitting end of day
                if(d.getTime() - serverStartTime > 120000) {
                    if(consoleOutput){ console.log("emitting end of day to all logged in users...") }
                    io.in("loggedin").emit("endOfDay")
                }
            }
        }
        clearInterval(intervalId)
        d = new Date()
        intervalId = setInterval(runGameClock, 60 * 1000 - d.getSeconds() * 1000)

    }
}

// checks if it currently active game time
function checkGameTime(d) {
    var currentTime = d.getHours()
    if (currentTime <= dayEnd && currentTime >= dayBegin) {
        if (activeGameTime == false) {
            // start game loop at start of day
            activeGameTime = true
            // reset active players list if it somehow survived the night
            activePlayers = []
            emittedEndOfDay = false
            gameLoop()   
        }
    } else {
        activeGameTime = false
    }
}

// main game loop of the app, runs every X seconds to move all players and check their scoring
function gameLoop() {
    // only start gameplay loop if during game hours
    if (activeGameTime) {

        var runGame = setInterval(gameplay, gameTiming)

        function gameplay() {

            if (activeGameTime) {
                if (activePlayers.length > 0) {

                    activePlayers.forEach(player => {

                        if (player.isTraveling) {
                            travel(player)
                        }
                        checkScoring(player)
                    });
                }
            }
            //end of day reached while server was running
            else {
                clearInterval(runGame)
                activePlayers.forEach(player => {
                    player.isTraveling = false
                    player.inStorm = false
                    player.stormsInside = []
                    player.pointNearChecked = []
                    player.speed = 0
                    player.duration = 0
                });
            }
        }
    }
}

// update where the player should be along their travel route based on real-time
function travel(player) {

    var distance = player.speed * (((new Date().getTime()) - player.startTime) / 1000)

    player.currentLocation = turf.along(player.route, distance)

    if(consoleOutput){ console.log(player.name + " now at " + player.currentLocation.geometry.coordinates) }

    if (turf.booleanEqual(player.currentLocation, player.destination)) {
        player.isTraveling = false
        if (player.isLoggedIn) {
            player.socket.emit("destinationReached", {
                currentLocation: player.currentLocation.geometry.coordinates
            })
        }
        if(consoleOutput){ console.log(player.name + " reached destination in " + ((((new Date().getTime()) - player.startTime) / 1000) / 60) + " minutes.") }
    }
}

/*
*****************************************************************************
                            Scoring and Weather
*****************************************************************************
*/

// checks if player is in any weather polygons, gives score for every 5 minutes
function checkScoring(player) {

    var time = new Date().getTime()
    player.inStorm = false
    // call scoring from highest points value to lowest 
    // as player should only get score from one storm poly at a time
    scorePolyStorm(tornadoWarn, tornWarnScore)
    scorePolyStorm(tornadoWatch, tornWatchScore)
    scorePolyStorm(tStormWarn, tsWarnScore)
    scorePolyStorm(tStormWatch, tsWatchScore)

    scorePointStorm(tornado, torn1, torn5)
    scorePointStorm(hail, hailsmall1, hailsmall5, isHail = true)
    scorePointStorm(wind, wind1, wind5)
    

    function scorePolyStorm(storms, scoring) {
        // only check score if player isn't already confirmed in polygon during this check
        if ( !player.inStorm && storms.length > 0) {
            // check every storm in this list
            for (var i = 0; i < storms.length; i++) {
                // if player is inside current storm
                if (turf.booleanPointInPolygon(player.currentLocation, storms[i])) {
                    // check if storm has been stored in player's stormsInside
                    if (player.stormsInside.length > 0) {
                        for(var ind = 0; ind < player.stormsInside.length; ind++) {
                            // if the storm was found stored in stormsInside
                            if (turf.booleanEqual(storms[i], player.stormsInside[ind][0])) {
                                // if it has been over X minutes since last recieving points for this storm, reset timer and award points
                                if (time - player.stormsInside[ind][1] >= scoreTiming) {
                                    player.currentScore += Math.round(scoring * player.scoreMultiplyer)
                                    player.totalScore += Math.round(scoring * player.scoreMultiplyer)
                                    player.stormsInside[ind][1] = time
                                    player.inStorm = true
                                    break
                                }
                                // if time hasn't been met, lock player out from recieving points from lower point storms that may overlap
                                else {
                                    player.inStorm = true
                                    break
                                }
                            } 
                        }  
                        // if storm was not stored in stormsInside, award points and store into stormsInside
                        if (!player.inStorm) {
                            player.stormsInside.push([storms[i], time])
                            player.inStorm = true
                            player.currentScore += Math.round(scoring * player.scoreMultiplyer)
                            player.totalScore += Math.round(scoring * player.scoreMultiplyer)
                            break
                        }
                        // else, storm was found and no more storms need to be checked
                        else {
                            break
                        }
                    }
                    // if stormsInside is empty, award points and store into stormsInside
                    else {
                        player.stormsInside.push([storms[i], time])
                        player.inStorm = true
                        player.currentScore += Math.round(scoring * player.scoreMultiplyer)
                        player.totalScore += Math.round(scoring * player.scoreMultiplyer)
                        break
                    }
                }
            }
        }
    }

    function scorePointStorm(storms, scoreone, scorefive, isHail = false) {
        if (storms.length > 0) {
            storms.forEach(storm => {
                var found = false
                if (player.pointNearChecked.length > 0) {
                    for (var i = 0; i < player.pointNearChecked.length; i++) {
                        if (turf.booleanEqual(player.pointNearChecked[i], storm.coordinates)) {
                            found = true
                            break
                        }
                    }
                }
                if (!found) {
                    var dist = turf.distance(player.currentLocation, storm.coordinates, { units: 'miles' })
                    if (dist > 1 && dist <= 5) {
                        if (isHail) {
                            if (storm.size == null || storm.size < 100) {
                                player.currentScore += Math.round(hailsmall5 * player.scoreMultiplyer)
                                player.totalScore += Math.round(hailsmall5 * player.scoreMultiplyer)
                            }
                            else if (storm.size >= 100 && storm.size < 200) {
                                player.currentScore += Math.round(hail1inch5 * player.scoreMultiplyer)
                                player.totalScore += Math.round(hail1inch5 * player.scoreMultiplyer)
                            }
                            else if (storm.size >= 200 && storm.size < 300) {
                                player.currentScore += Math.round(hail2inch5 * player.scoreMultiplyer)
                                player.totalScore += Math.round(hail2inch5 * player.scoreMultiplyer)
                            }
                            else if (storm.size >= 300) {
                                player.currentScore += Math.round(hail3inch5 * player.scoreMultiplyer)
                                player.totalScore += Math.round(hail3inch5 * player.scoreMultiplyer)
                            }
                        } else {
                            player.currentScore += Math.round(scorefive * player.scoreMultiplyer)
                            player.totalScore += Math.round(scorefive * player.scoreMultiplyer)
                        }
                    }
                    else if (dist < 1) {
                        if (isHail) {
                            if (storm.size == null || storm.size < 100) {
                                player.currentScore += Math.round(hailsmall1 * player.scoreMultiplyer)
                                player.totalScore += Math.round(hailsmall1 * player.scoreMultiplyer)
                            }
                            else if (storm.size >= 100 && storm.size < 200) {
                                player.currentScore += Math.round(hail1inch1 * player.scoreMultiplyer)
                                player.totalScore += Math.round(hail1inch1 * player.scoreMultiplyer)
                            }
                            else if (storm.size >= 200 && storm.size < 300) {
                                player.currentScore += Math.round(hail2inch1 * player.scoreMultiplyer)
                                player.totalScore += Math.round(hail2inch1 * player.scoreMultiplyer)
                            }
                            else if (storm.size >= 300) {
                                player.currentScore += Math.round(hail3inch1 * player.scoreMultiplyer)
                                player.totalScore += Math.round(hail3inch1 * player.scoreMultiplyer)
                            }
                        }
                        else {
                            player.currentScore += Math.round(scoreone * player.scoreMultiplyer)
                            player.totalScore += Math.round(scoreone * player.scoreMultiplyer)
                        }
                    }
                    player.pointNearChecked.push(storm.coordinates)
                }
            });
        }
    }
}

// fills current storm arrays from the main storm JSON
function fillStormArrays() {
    tornadoWarn = storms.storms[0].instances
    tornadoWatch = storms.storms[1].instances
    tStormWarn = storms.storms[2].instances
    tStormWatch = storms.storms[3].instances
    wind = storms.storms[4].instances
    tornado = storms.storms[5].instances
    hail = storms.storms[6].instances
}

// Checks if any storm information has changed since last update
function stormsHaveChanged() {
    if (tornadoWarn.length == storms.storms[0].instances.length) {
        for (var i = 0; i < tornadoWarn.length; i++) {
            if (!turf.booleanEqual(tornadoWarn[i], storms.storms[0].instances[i])) {
                if(consoleOutput){ console.log("tornadoWarns have changed.") }
                return true
            }
        }
    }
    else {
        if(consoleOutput){ console.log("tornadoWarns have changed.") }
        return true
    }
    if (tornadoWatch.length == storms.storms[1].instances.length) {
        for (var i = 0; i < tornadoWatch.length; i++) {
            if (!turf.booleanEqual(tornadoWatch[i], storms.storms[1].instances[i])) {
                if(consoleOutput){ console.log("tornadoWatches have changed.") }
                return true
            }
        }
    }
    else {
        if(consoleOutput){ console.log("tornadoWatches have changed.") }
        return true
    }
    if (tStormWarn.length == storms.storms[2].instances.length) {
        for (var i = 0; i < tStormWarn.length; i++) {
            if (!turf.booleanEqual(tStormWarn[i], storms.storms[2].instances[i])) {
                if(consoleOutput){ console.log("thunderStormWarns have changed.") }
                return true
            }
        }
    }
    else {
        if(consoleOutput){ console.log("thunderStormWarns have changed.") }
        return true
    }
    if (tStormWatch.length == storms.storms[3].instances.length) {
        for (var i = 0; i < tStormWatch.length; i++) {
            if (!turf.booleanEqual(tStormWatch[i], storms.storms[3].instances[i])) {
                if(consoleOutput){ console.log("thunderStormWatches have changed.") }
                return true
            }
        }
    }
    else {
        if(consoleOutput){ console.log("thunderStormWatches have changed.") }
        return true
    }
    if (wind.length != storms.storms[4].instances.length) {
        if(consoleOutput){ console.log("wind reports updated.") }
        return true
    }
    if (tornado.length != storms.storms[5].instances.length) {
        if(consoleOutput){ console.log("tornado reports updated.") }
        return true
    }
    if (hail.length != storms.storms[6].instances.length) {
        if(consoleOutput){ console.log("hail reports updated.") }
        return true
    }
    if(consoleOutput){ console.log("no storm reports have changed.") }
    return false
}

// How the weather information is formatted when its sent to the app
function formatWeather() {
    formattedStorms = []

    for(var i = 0; i < 4; i++) {
        sub = []
        storms.storms[i].instances.forEach(polygon => {
            sub.push({
                "Type": "Polygon",
                "coordinates": polygon.geometry.coordinates
            })
        });
        formattedStorms.push(sub)
    }
    for(var i = 4; i < 6; i++) {
        sub = []
        storms.storms[i].instances.forEach(point => {
            sub.push({
                "Type": "Point",
                "coordinates": point.coordinates.geometry.coordinates
            })
        })
        formattedStorms.push(sub)
    }
    var temphail = []
    for(var i = 0; i < storms.storms[6].instances.length; i++) {
        temphail.push({
            "Type": "Point",
            "Size": storms.storms[6].instances[i].size,
            "coordinates": storms.storms[6].instances[i].coordinates.geometry.coordinates
        })
    }
    formattedStorms.push(temphail)

    return { "storms": formattedStorms }
}