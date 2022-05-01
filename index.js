require('dotenv').config();
const functions = require("firebase-functions");
const app = require('express')();
const cors = require('cors');
// const { initializeApp } = require('firebase/app');
// const { getAuth } = require("firebase/auth");
// const config = require('./config');
// const app = initializeApp(config);
// const auth = getAuth();
//const { admin, db } = require('./utils/admin');
const auth = require('./utils/auth');

app.use(cors({ origin: true }));

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
  getRestaurant,
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

  getRestaurantMenus,
  postRestaurantMenu,
  getRestaurantGallery,
  postRestaurantPhoto,
} = require('./APIs/restaurants')

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

app.get('/partner/restaurant', auth, getPartnerRestaurant);
app.put('/partner/restaurant', auth, editRestaurant);
app.get('/partner/deals', auth, getDeals);
app.get('/partner/deal/:dealId', auth, getDeal);
app.put('/partner/deal/:dealId', auth, updateDeal);
app.delete('/partner/deal/:dealId', auth, deleteDeal);
app.post('/partner/deal', auth, createDeal);
app.get('/partner/reservations', auth, getReservationsList);

app.get('/categories', getCategories);
app.post('/categories', auth, createCategory);

app.get('/restaurant/menus', auth, getRestaurantMenus);
app.post('/restaurant/menus', auth, postRestaurantMenu);
app.get('/restaurant/photos', auth, getRestaurantGallery);
app.post('/restaurant/photos', auth, postRestaurantPhoto);
app.post('/restaurant/create', auth, createRestaurant);
app.get('/restaurant/:restaurantName/available-name', isRestaurantNameAvailable);
app.get('/restaurant/:restaurantId', getRestaurant);
//app.put('/restaurant/:restaurantId', editRestaurant);
app.post('/restaurant/image', auth, uploadRestaurantProfilePhoto);


exports.api = functions.https.onRequest(app);