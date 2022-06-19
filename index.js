require('dotenv').config();
const functions = require("firebase-functions");
const app = require('express')();
const bodyParser = require('body-parser')
const cors = require('cors');
// const { initializeApp } = require('firebase/app');
// const { getAuth } = require("firebase/auth");
// const config = require('./config');
// const app = initializeApp(config);
// const auth = getAuth();
//const { admin, db } = require('./utils/admin');
const auth = require('./utils/auth');
const { updateDealStatus } = require('./utils/update-deal-status');
const { updateReservationStatus } = require('./utils/update-reservation-status');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(cors({ "origin": "*" }));

const {
    getUserFavorites,
    getUserDeals,
    getUserRestaurants,
    createUser,
    //getUser,
    getCurrentUser,
    editUser,
    isUsernameAvailable,

    getPartnerRestaurant
} = require('./APIs/users')

const {
  createRestaurant,
  editRestaurant,
  isRestaurantNameAvailable,
  uploadRestaurantProfilePhoto,
  
  getDeal,
  getDeals,
  createDeal,
  updateDeal,
  deleteDeal,

  getReservationsList,

  getCategories,
  createCategory,
  createQR,

  getRestaurantMenus,
  postRestaurantMenu,
  postRestaurantPhoto,
} = require('./APIs/partners');

const {
  getRestaurant,
  getRestaurants,
  getRestaurantDeal,
  getRestaurantDeals,
  getRestaurantGallery
} = require('./APIs/restaurants');

const {
  getReservation,
  createReservation,
  cancelReservation
} = require('./APIs/reservations');

const {
  redeemDeal,
  findDeal,
  deleteAllDeals
} = require('./APIs/deals');

const {
  addFavorite,
  getFavorites,
  removeFavorite
} = require('./APIs/favorites');


const {
  loginUser
} = require('./APIs/auth')

app.post('/auth/login', loginUser);

app.post('/user/create', createUser);
app.get('/user', auth, getCurrentUser);
//app.get('/user/:userId', getUser);
app.put('/user/:userId/edit', editUser);
app.get('/user/:userId/favorites', getUserFavorites);
app.get('/user/:userId/deals', getUserDeals);
app.get('/user/:userId/restaurants', getUserRestaurants);
app.get('/user/:email/available', isUsernameAvailable);

app.get('/reservations/:reservationId', auth, getReservation);
app.post('/reservations', auth, createReservation);
app.delete('/reservations/:reservationId', auth, cancelReservation);

app.get('/partner/restaurant', auth, getPartnerRestaurant);
app.put('/partner/restaurant', auth, editRestaurant);
app.get('/partner/deals', auth, getDeals);
app.get('/partner/deal/:dealId', auth, getDeal);
app.put('/partner/deal/:dealId', auth, updateDeal);
app.delete('/partner/deal/:dealId', auth, deleteDeal);
app.post('/partner/deal', auth, createDeal);
app.get('/partner/reservations', auth, getReservationsList);
app.post('/partner/createQR', auth, createQR);

app.get('/categories', getCategories);
app.post('/categories', auth, createCategory);

app.get('/restaurant/menus', auth, getRestaurantMenus);
app.post('/restaurant/menus', auth, postRestaurantMenu);
app.post('/restaurant/photos', auth, postRestaurantPhoto);
app.post('/restaurant/image', auth, uploadRestaurantProfilePhoto);
app.post('/restaurant/create', auth, createRestaurant);
app.get('/restaurant/:restaurantName/available-name', isRestaurantNameAvailable);
//app.put('/restaurant/:restaurantId', editRestaurant);

app.get('/restaurants', getRestaurants);
app.get('/restaurant/:restaurantId', getRestaurant);
app.get('/restaurant/:restaurantId/deals', getRestaurantDeals);
app.get('/restaurant/:restaurantId/deals/:dealId', getRestaurantDeal);
app.get('/restaurant/:restaurantId/photos', getRestaurantGallery);

// Deals
app.post('/deals/redeem', auth, redeemDeal);
//app.post('/deals/deleteAllDeals', auth, deleteAllDeals); // <------ DAnGEROUS UTILITY 
app.get('/deals/qr-scan/:restaurantId', auth, findDeal);

// Favorites
app.get('/favorites', auth, getFavorites);
app.post('/favorites/:restaurantId', auth, addFavorite);
app.delete('/favorites/:restaurantId', auth, removeFavorite);

//
exports.api = functions.https.onRequest(app);

// app.get('/deals-status', updateDealStatus)
exports.updateDealStatus = functions.pubsub
    .schedule('*/15 * * * *')
    .timeZone('America/Mexico_City')
    .onRun(updateDealStatus);

// app.get('/reservation-status', auth, updateReservationStatus);
exports.updateDealStatus = functions.pubsub
    .schedule('*/15 * * * *')
    .timeZone('America/Mexico_City')
    .onRun(updateReservationStatus);