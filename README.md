# Armchair Storm Chasing Node.js Server
Developed as a capstone project at Ball State University 2019

Project members: Robert Gunderson, Jacob Hahn, William Moore, and Ian Pemberton

Based off of a previous capstone project by Daniel Payton, Dylon Price, Isaac Walling, David Wisenberg

## Functionality
Supports the Android App Armchair Storm Chasing with real-time weather data, simulated route traveling, and points scoring based on simulated proximity to real-time storm data. Through the use of Socket.IO and the Heroku hosting platform, this server provides the gameplay functions for the app. 

## Usage
### Socket.IO Connection
The Server/App connection and communication is handled with socketIO, a real-time message based connection system. A set of emitters and listeners on both the app and server facilitate this message passing.

![chart]

[chart]: https://i.imgur.com/kkWt6Bx.png?1 "Emit Flow Chart"
For the Server and Mobile App to function properly, there is a set order that the app side emitters may emit to receive valid data from the server.

#### Connection
On the app side, a socket connection is established on the server through creating a socket inside the Application class:
```Java
public class ArmchairStormChaser extends Application {
    private Socket mSocket;
    public Socket getSocket(){
        if(mSocket == null) {
            try {
                mSocket = IO.socket(SERVER_URL);
            } catch (URISyntaxException e) {
                throw new RuntimeException(e);
            }
        }
        return mSocket;
    }
}
```
By placing the socket in the Application, you are able to maintain a single, persistent socket connection throughout your application. To retrieve this socket, simply use something along the lines of:

```Java
ArmchairStormChaser app = (ArmchairStormChaser)getApplication();
Socket  socket = app.getSocket();
socket.connect();
```
The socket connection will automatically handle its own connection and reconnection attempts.

---

#### Get Weather Updates
While not mentioned on the flow chart, at any point after a connection has been established, the app may request a weather update from the server through:
```Java
socket.emit("getWeatherUpdate");
```
The server stores the weather data in the form of a JSON object formatted as:
```Javascript
 {
    "storms": [
        {"name": "Tornado Warning", "type": "polygon", "instances": []},
        {"name": "Tornado Watch", "type": "polygon", "instances": []},
        {"name": "Severe Thunderstorm Warning", "type": "polygon", "instances": []},
        {"name": "Severe Thunderstorm Watch", "type": "polygon", "instances": []},
        {"name": "Wind", "type": "point", "instances": []},
        {"name": "Tornado", "type": "point", "instances": []},
        {"name": "Hail", "type": "point", "instances": []}
    ]
}
```
With the individual instances of the polygon type storms formatted as a doubly nested array of coordinates, with the first and last coordinates matching to form a polygon, as exampled:
```Javascript
{
    [ 
        [ 
            [ -86.3964844, 41.2117215 ],
            [ -84.8803711, 40.9798981 ],
            [ -88.0554199, 40.5722401 ],
            [ -86.3964844, 41.2117215 ]
         ] 
    ]
}
```

The Wind and Tornado point type instances are formatted as:

```Javascript
{ time: 1237,
  coordinates:
   { type: 'Feature',
     properties: {},
     geometry: { type: 'Point', coordinates: [ -86.1726379, 39.7731863 ] } 
   } 
}
```

And the Hail formatted as:
```Javascript
{ time: 17,
  size: 250,
  coordinates:
   { type: 'Feature',
     properties: {},
     geometry: { type: 'Point', coordinates: [ -86.1726379, 39.7731863 ] } 
   } 
}
```
**However, when sent out to the app, the weather is formatted as:**
```Javascript
{ "storms": [
                {
                    "Type": "Polygon",
                    "coordinates": [ 
                                        [ 
                                            [ -86.3964844, 41.2117215 ],
                                            [ -84.8803711, 40.9798981 ],
                                            [ -88.0554199, 40.5722401 ],
                                            [ -86.3964844, 41.2117215 ]
                                         ] 
                                    ]
                },
                {
                    "Type": "Polygon",
                    "coordinates": [Array]
                },
                {
                    "Type": "Polygon",
                    "coordinates": [Array]
                },
                {
                    "Type": "Polygon",
                    "coordinates": [Array]
                },
                {
                    "Type": "Point",
                    "coordinates": [-86.1726379, 39.7731863]
                },
                {
                    "Type": "Point",
                    "coordinates": [Array]
                },
                {
                    "Type": "Point",
                    "Size": 250,
                    "coordinates": [-86.1726379, 39.7731863]
                }
            ] 
}
```
---
#### Login
In order to use the Armchair Storm Chasing Server, a user must first login. This can be done app side through:
```Java
socket.emit("login", username, passkey, currentScore, totalScore, scoreMultiplyer)
```
Where username is the username string, passkey is a unique string generated by the app to differentiate player profiles, currentScore is the player's current score for the day, totalScore is the total overall score, and scoreMultiplier is the multiplier applied to every scoring increment based on whether the player had started the day from their previous location or chosen a new location.

In reaction to a login emit, the server will emit back either **loginSuccess** if it is the first time the player is logging into that account that day and has not yet chosen a starting location, or **loginFromPrevious** if the user had previously logged in that day and already chosen a start location. From this, the app can choose which screen to sent the user to.

the **loginFromPrevious** emit sends a JSON object filled with the player's current info from the server:
```Javascript
 {
    "dailyScore": "Player's current score", 
    "totalScore": "Player's total score", 
    "currentLon": "Longitude of Player's current location",
    "currentLat": "Latitude of Player's current location",
    "routeGeometry": "The route the player was traveling on as an encoded polyline",
    "destLon": "Longitude of destination",
    "destLat": "Latitude of destination",
    "isTraveling": "Boolean whether the Player is currenlty traveling or not" 
}
```
---
#### Start Location Select
After logging in for the first time, or the first time that day, and before being able to do anything else other than logging off and pulling weather data, the Player must select a starting position. This selection can be sent to the server through:
```Java
socket.emit("startLocationSelect", longitude, latitude, scoreMultiplyer);
```
The score multiplyer is decided by whether the player is continuing from a previous location or selecting a new location. A brand new player should always have a scoreMultiplier of 1.
Once a starting location has been selected and emitted, the player may select a travel route and receive player updates. startLocationSelect may only be called once per day per account.

---
#### Set Travel Route
As long as the player is logged in, has chosen a starting location, and is not already traveling, they may set a travel route and start traveling along it through:
```Java
socket.emit("setTravelRoute", geometry, distance, duration, destinationLongitude, destinationLatitude);
```
Where **geometry** is an encoded polyline containing the linestring coordinates for the selected route, **distance** is how long the route is in meters, and **duration** is the time in seconds that the route should take to complete.

---
#### Stop Travel
At any point during a player's travel route, they may stop movement with:
```Java
socket.emit("stopTravel");
```
And the player will stop movement immediately.

---
#### Player Update
At any point after loggin in and already having a start location selected, the app may request a player update from the server through:
```Java
socket.emit("getPlayerUpdate");
```
and in response the server sends an **updatePlayer** emit to the app, which contains a JSON object formatted as:
```Javascript
{
    "currentLocation": [longitude, latitude],
    "currentScore": currentScore,
    "totalScore": totalScore,
    "timeLeft": timeleft
}
```
where time left is the number of seconds left on the current route if player is traveling, 0 otherwise.

---
#### Log Out
At any point after logging in, the user may log out of their current profile with:
```Java
socket.emit("logout");
```

---
#### Disconnect
When the connection between the app and server is lost for any reason, a **disconnect** emit is automatically sent to both server and app, and any necessary work for handling a disconnect can be placed into the disconnect listener.

---
#### Error Messages
If at any point the server receives an illegal emit for the Player's current status, the server will send to the app an error message detailing the illegal action, which can be picked up by the app through a listener on **errorMessage**

---
