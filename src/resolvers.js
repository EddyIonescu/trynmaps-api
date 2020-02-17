const s3Helper = require('./helpers/s3Helper.js');
const removeMuniMetroDuplicates = require('./helpers/removeMuniMetroDuplicates');
const BigInt = require('./bigint');

const _ = require('lodash');

const debug = !!process.env.DEBUG;

const resolvers = {

    // use BigInt to represent Unix timestamps because GraphQL Int type is only 32-bit
    // and would overflow in January 2038 https://github.com/graphql/graphql-js/issues/292
    BigInt: BigInt,

    Query: {
        state: async (obj, params) => {
            const { agencyId, routes } = params;

            let { startTime, endTime } = params;

            const vehicles = await s3Helper.getVehicles(agencyId, startTime, endTime);

            const vehiclesByTripByTime = {};
            const vehiclesByRouteByTime = {};

            // group the vehicles by route, and then by time

            vehicles.forEach(vehicle => {
                const routeId = vehicle.rid;
                const vtime = vehicle.timestamp;

                if (!vehiclesByRouteByTime[routeId]) {
                    vehiclesByRouteByTime[routeId] = {};
                }
                if (!vehiclesByRouteByTime[routeId][vtime]) {
                    vehiclesByRouteByTime[routeId][vtime] = [];
                }

                // check for multiple vehicles with the same tripId, assume to be multiple-car trains if close to each other
                const tripId = vehicle.tripId;
                if (tripId) {
                    if (!vehiclesByTripByTime[tripId]) {
                        vehiclesByTripByTime[tripId] = {};
                    }
                    const prevVehicle = vehiclesByTripByTime[tripId][vtime];
                    if (!prevVehicle) {
                        vehiclesByTripByTime[tripId][vtime] = vehicle;
                    } else if (Math.abs(prevVehicle.lat - vehicle.lat) < 0.001 && Math.abs(prevVehicle.lon - vehicle.lon) < 0.001) {
                        // 0.001 degrees latitude = 111m, 0.001 degrees longitude typically between between ~50m and 111m
                        prevVehicle.numCars = (prevVehicle.numCars || 1) + 1;
                        if (prevVehicle.vid > vehicle.vid) {
                            prevVehicle.vid = vehicle.vid;
                        }
                        return;
                    }
                }

                vehiclesByRouteByTime[routeId][vtime].push(vehicle);
            });

            // remove duplicate Muni Metro vehicles
            if (agencyId === 'muni') {
                const affectedRouteIDs = ['KT', 'L', 'M', 'N', 'J'];
                affectedRouteIDs.forEach(routeID => {
                    if (debug) {
                        console.log(routeID);
                    }
                    if (vehiclesByRouteByTime[routeID]) {
                        vehiclesByRouteByTime[routeID] = removeMuniMetroDuplicates(
                            vehiclesByRouteByTime[routeID],
                        );
                    }
                });
            }

            // get all the routes
            const routeIDs = routes ?
                _.intersection(routes, Object.keys(vehiclesByRouteByTime)) :
                Object.keys(vehiclesByRouteByTime);

            return {
                agencyId,
                routeIDs,
                startTime,
                endTime,
                vehiclesByRouteByTime
            };
        },
    },

    AgencyState: {
        agencyId: obj => obj.agencyId,
        startTime: obj => obj.startTime,
        endTime: obj => obj.endTime,
        routes: obj => {
            return obj.routeIDs.map((rid) => {
                return {id: rid, agencyId: obj.agencyId, vehiclesByTime: obj.vehiclesByRouteByTime[rid]};
            });
        }
    },

    RouteHistory: {
        routeId: route => route.id,
        states: route => {
            const vehiclesByTime = route.vehiclesByTime || {};
            return Object.keys(vehiclesByTime).map((timestamp) => ({
                timestamp: timestamp,
                vehicles: vehiclesByTime[timestamp],
            }));
        }
    },

    VehicleState: {
        vid: vehicle => vehicle.vid,
        did: vehicle => vehicle.did,
        lat: vehicle => vehicle.lat,
        lon: vehicle => vehicle.lon,
        heading: vehicle => vehicle.heading,
        secsSinceReport: vehicle => vehicle.secsSinceReport,
        numCars: vehicle => vehicle.numCars,
        tripId: vehicle => vehicle.tripId,
        stopId: vehicle => vehicle.stopId,
        stopIndex: vehicle => vehicle.stopIndex,
        status: vehicle => vehicle.status,
    }
};

module.exports = resolvers;
