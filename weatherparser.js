'use strict';
var request = require('request');
var fs = require('fs');
var papa = require('papaparse')
var url = 'https://api.weather.gov/alerts/active';
var turf = require('@turf/turf')

module.exports = {
    parse: () => {
        // json object to hold all weather data
        var weather = {
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
        // get the storm warning and watches
        request.get({
            url: url,
            json: true,
            headers: {'User-Agent': 'request'}
            }, (err, res, data) => {
                if (err) {
                    console.log('Error:', err);
                } else if (res.statusCode !== 200) {
                    console.log('Status:', res.statusCode);
                } else {
                    var tornadoWarn = [] 
                    var tornadoWatch = [] 
                    var tStormWarn = [] 
                    var tStormWatch = []
                    for(var i = 0; i < data.features.length; i++) {

                        if (data.features[i].geometry != null) {
                            if (data.features[i].properties.event == 'Tornado Warning') {  
                                tornadoWarn.push(turf.polygon(data.features[i].geometry.coordinates))
                            }
                            else if (data.features[i].properties.event == 'Tornado Watch') {
                                tornadoWatch.push(turf.polygon(data.features[i].geometry.coordinates))
                            }
                            else if (data.features[i].properties.event == 'Severe Thunderstorm Warning') {
                                tStormWarn.push(turf.polygon(data.features[i].geometry.coordinates))
                            }
                            else if (data.features[i].properties.event == 'Severe Thunderstorm Watch') {
                                tStormWatch.push(turf.polygon(data.features[i].geometry.coordinates))
                            }
                        }
                    }
                    weather.storms[0].instances = tornadoWarn
                    weather.storms[1].instances = tornadoWatch
                    weather.storms[2].instances = tStormWarn
                    weather.storms[3].instances = tStormWatch
            }

        });

        var hail = []
        var tornado = []
        var wind = []

        const windUrl = 'https://www.spc.noaa.gov/climo/reports/today_filtered_wind.csv';
        const tornadoUrl ='https://www.spc.noaa.gov/climo/reports/today_torn.csv';
        const hailUrl ='https://www.spc.noaa.gov/climo/reports/today_hail.csv';

        // get the wind reports
        papa.parse(windUrl, {
            download: true,
            header: true,
            step: function(row) {
                var obj = row.data[0]
                if (obj.Time != null && obj.Lon != null && obj.Lat != null) {
                    wind.push({ "time": obj.Time, "coordinates": turf.point([parseFloat(obj.Lon), parseFloat(obj.Lat)]) })
                }
            },
            complete: function() {
                weather.storms[4].instances = wind
            }
        });

        // get the tornado reports
        papa.parse(tornadoUrl, {
            download: true,
            header: true,
            step: function(row) {
                var obj = row.data[0]
                if (obj.Time != null && obj.Lon != null && obj.Lat != null) {
                    tornado.push({ "time": obj.Time, "coordinates": turf.point([parseFloat(obj.Lon), parseFloat(obj.Lat)]) })
                }
            },
            complete: function() {
                weather.storms[5].instances = tornado
            }
        });
        
        // get the hail reports
        papa.parse(hailUrl, {
            download: true,
            header: true,
            step: function(row) {
                var obj = row.data[0]
                if (obj.Time != null && obj.Lon != null && obj.Lat != null) {
                    hail.push({ "time": obj.Time, "size": obj.Size, "coordinates": turf.point([parseFloat(obj.Lon), parseFloat(obj.Lat)]) })
                }
            },
            complete: function() {
                weather.storms[6].instances = hail
            }
        });

        return weather
    }
}