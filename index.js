require("dotenv").config();
const functions = require("firebase-functions");
const app = require("express")();
const bodyParser = require("body-parser");
const cors = require("cors");
const { collection, getDocs, query, updateDoc, where } = require('firebase/firestore');
const algoliasearch = require("algoliasearch");
const { db } = require('./utils/admin');
const { USER_ROLES } = require('./utils/app-config');
const { isAuthenticated, isAuthorizated } = require("./utils/auth");
const { RESERVATION_STATUS } = require('./utils/reservations-utils');
const { updateDealStatus } = require("./utils/update-deal-status");
const {
  updateReservationStatus,
} = require("./utils/update-reservation-status");

// 'Global' configuration
const NODE_ENV = process.env.NODE_ENV || 'production';

// Configure Express App
app.use(bodyParser.json());
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);
app.use(cors({ origin: "*" }));

// Config Algolia SDK
const algoliaClient = algoliasearch(
  process.env.ALGOLIA_APP_ID,
  process.env.ALGOLIA_ADMIN_API_KEY
);
const algoliaIndex = algoliaClient.initIndex("Restaurants");

const {
  getUserDeals,
  getUserRestaurants,
  createUser,
  getUser,
  deleteUser,
  getUsers,
  getCurrentUser,
  editUser,
  isUsernameAvailable,

  getPartnerRestaurant,
} = require("./APIs/users");

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

  createQR,

  getRestaurantMenus,
  postRestaurantMenu,
  postRestaurantPhoto,
  importRestaurants,
  updateAllRestaurants
} = require("./APIs/partners");

const {
  getCategories,
  createCategory
} = require('./APIs/categories');

const {
  getRestaurant,
  getRestaurants,
  testFunction,
  getRestaurantDeal,
  getRestaurantDeals,
  getRestaurantGallery,
  searchRestaurants,
  editRestaurant: editRestaurantGeneral,
  createRestaurant: createRestaurantGeneral,
  deleteRestaurant: deleteRestaurantGeneral
} = require("./APIs/restaurants");

const {
  getReservation,
  createReservation,
  cancelReservation,
} = require("./APIs/reservations");

const { redeemDeal, findDeal, deleteAllDeals } = require("./APIs/deals");

const {
  addFavorite,
  getFavorites,
  removeFavorite,
} = require("./APIs/favorites");

const { loginUser, logoutUser, resetPassword, verificateUserEmail } = require("./APIs/auth");
const { setUserRole } = require("./APIs/admin");


app.post("/auth/login", loginUser);
app.post("/auth/logout", isAuthenticated, logoutUser);
app.post("/auth/password-reset/:email", resetPassword);
app.post("/auth/email-verification/:userId", verificateUserEmail);

// Users
app.get("/users", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), getUsers);
app.post("/user", createUser);
app.get("/user", isAuthenticated, getCurrentUser);
app.get('/user/:userId', getUser);
app.put("/user/:userId", editUser);
app.delete("/user/:userId", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), deleteUser);
app.get("/user/:userId/deals", getUserDeals);
app.get("/user/:userId/restaurants", getUserRestaurants);
app.get("/user/:email/available", isUsernameAvailable);

// Reservations
app.get("/reservations/:reservationId", isAuthenticated, getReservation);
app.post("/reservations", isAuthenticated, createReservation);
app.delete("/reservations/:reservationId", isAuthenticated, cancelReservation);

app.get("/partner/restaurant", isAuthenticated, getPartnerRestaurant);
app.put("/partner/restaurant", isAuthenticated, editRestaurant);
app.get("/partner/deals", isAuthenticated, getDeals);
app.get("/partner/deal/:dealId", isAuthenticated, getDeal);
app.put("/partner/deal/:dealId", isAuthenticated, updateDeal);
app.delete("/partner/deal/:dealId", isAuthenticated, deleteDeal);
app.post("/partner/deal", isAuthenticated, createDeal);
app.get("/partner/reservations", isAuthenticated, getReservationsList);
app.post("/partner/createQR", isAuthenticated, createQR);

app.get("/categories", getCategories);
app.post("/categories", isAuthenticated, createCategory);

app.get("/restaurant/menus", isAuthenticated, getRestaurantMenus);
app.post("/restaurant/menus", isAuthenticated, postRestaurantMenu);
app.post("/restaurant/photos", isAuthenticated, postRestaurantPhoto);
app.post("/restaurant/image", isAuthenticated, uploadRestaurantProfilePhoto);
app.post("/restaurant/create", isAuthenticated, createRestaurant);
app.get(
  "/restaurant/:restaurantName/available-name",
  isRestaurantNameAvailable
);

app.get("/restaurants", getRestaurants);
app.get("/restaurant", getRestaurant);
app.post("/restaurant", isAuthenticated, createRestaurantGeneral);
app.get("/restaurant/:restaurantId", getRestaurant);
app.delete("/restaurant/:restaurantId", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), deleteRestaurantGeneral);
app.put("/restaurant/:restaurantId", isAuthenticated, editRestaurantGeneral);
app.get("/restaurant/:restaurantId/deals", getRestaurantDeals);
app.get("/restaurant/:restaurantId/deals/:dealId", getRestaurantDeal);
app.get("/restaurant/:restaurantId/photos", getRestaurantGallery);

// Deals
app.post("/deals/redeem", isAuthenticated, redeemDeal);
app.get("/deals/qr-scan/:restaurantId", isAuthenticated, findDeal);

// Favorites
app.get("/favorites", isAuthenticated, getFavorites);
app.post("/favorites/:restaurantId", isAuthenticated, addFavorite);
app.delete("/favorites/:restaurantId", isAuthenticated, removeFavorite);

// Search
app.post("/search/:indexName/query", searchRestaurants);

// Admin
app.post("/admin/setUserRole", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), setUserRole);

// Utils
app.post("/import/restaurants", importRestaurants);
app.put("/update/restaurants", updateAllRestaurants);

//
const handleError = async (err, req, res) => {
  //console.log(err);
  return res.status(err.status).json({ ...err, error: err.message });
  //res.status(400).send(err);
}
app.use(handleError);


//app.post('/deals/deleteAllDeals', isAuthenticated, deleteAllDeals); // <------ DAnGEROUS UTILITY
// app.get('/deals-status', isAuthenticated, updateDealStatus) // <-- UTILITY
// app.get('/reservation-status', isAuthenticated, updateReservationStatus); // <-- UTILITY

//
exports.api = functions.https.onRequest(app);

////////////////////////////////////////
// CronJobs
exports.updateDealStatus = functions.pubsub
  .schedule("*/15 * * * *")
  .timeZone("America/Mexico_City")
  .onRun(updateDealStatus);

exports.updateReservationStatus = functions.pubsub
  .schedule("*/15 * * * *")
  .timeZone("America/Mexico_City")
  .onRun(updateReservationStatus);


////////////////////////////////////////
// Restaurants Events
//if(NODE_ENV == 'production'){
  exports.onCreateRestaurant = functions.firestore
    .document("Restaurants/{restaurantId}")
    .onCreate(async (snap, context) => {
      const restaurant = snap.data();
      const newRestaurant = {
        objectID: snap.id,
        ...restaurant,
        createdAt: restaurant.createdAt._seconds,
        _geoloc: {
          lng: -99.174933,
          lat: 19.408135,
        },
        deals: []
      };

      // Add or update new objects
      algoliaIndex
        .saveObject(newRestaurant)
        .then(() => {
          console.log("Documents imported into Algolia");
          process.exit(0);
        })
        .catch((error) => {
          console.error("Error when importing documents into Algolia", error);
          process.exit(1);
        });
    });

  exports.onUpdateRestaurant = functions.firestore
    .document("Restaurants/{restaurantId}")
    .onUpdate(async (snap, context) => {
      const { location, ...restaurant } = snap.after.data();
      const hasPhoto = Boolean(restaurant.photo && restaurant.photo !== '');
      const hasAvatar = Boolean(restaurant.avatar && restaurant.avatar !== '');

      /*--------------------- ALGOLIA ---------------------*/
      // Verify if restaurant has active deals
      let hasDeals = false;
      const dealsList = await getDocs(query(
        collection(db, 'Deals'),
        where('restaurantId', '==', snap.after.id),
        where('status', '==', true)
      ));
      if(dealsList.size){
        hasDeals = true;
      }

      // Create updated object
      const updatedRestaurant = {
        objectID: snap.after.id,
        ...restaurant,
        createdAt: restaurant.createdAt._seconds,
        location,
        _geoloc: {
          lng: location.longitude,
          lat: location.latitude,
        },
        hasPhoto: hasPhoto,
        hasAvatar: hasAvatar,
        hasDeals
      };

      // // Add or update new objects
      algoliaIndex
        .partialUpdateObject(updatedRestaurant)
        .then(() => {
          console.log("Documents imported into Algolia");
          process.exit(0);
        })
        .catch((error) => {
          console.error("Error when importing documents into Algolia", error);
          process.exit(1);
        });
    });
  exports.onDeleteRestaurant = functions.firestore
    .document("Restaurants/{restaurantId}")
    .onDelete(async (snap, context) => {
      // Add or update new objects
      algoliaIndex
        .deleteObject(snap.id)
        .then(() => {
          console.log("Documents removed from Algolia");
          process.exit(0);
        })
        .catch((error) => {
          console.error("Error when removing documents from Algolia", error);
          process.exit(1);
        });
    });

  // Deals Events
  exports.onCreateDeal = functions.firestore
    .document("Deals/{dealId}")
    .onCreate(async (snap, context) => {
      const deal = snap.data();

      // verify if deal is active
      if(!deal.active){
        console.log("Deal is not active");
        process.exit(0);
      }

      // Get current indexed deals
      const restaurant = await algoliaIndex.getObject(deal.restaurantId, {
        attributesToRetrieve: ['deals']
      });
      let deals = [];
      if(restaurant.deals){
        deals = [...restaurant.deals]
      }

      // add deal
      deals = [...deals, {
        ...deal,
        id: snap.id,
        dealType: deal.dealType == 1 ? 'discount' : 'promotion'
      }];

      // create deal object
      const restaurantUpdate = {
        objectID: deal.restaurantId,
        deals,
        hasDeals: true
      };

      // Add or update new objects
      algoliaIndex
        .partialUpdateObject(restaurantUpdate)
        .then(() => {
          console.log("Documents imported into Algolia");
          process.exit(0);
        })
        .catch((error) => {
          console.error("Error when importing documents into Algolia", error);
          process.exit(1);
        });
    });

  exports.onUpdateDeal = functions.firestore
    .document("Deals/{dealId}")
    .onUpdate(async (snap, context) => {
      const deal = snap.after.data();

      // Cancel all reservations linked to the deal
      if(!deal.active){
        const reservationsCollection = query(
          collection(db, 'Reservations'),
          where('dealId', '==', snap.after.id),
          where('active', '==', true)
        );
        const reservations = await getDocs(reservationsCollection);
        
        if(reservations.size){
          for(const reservation of reservations.docs){
            await updateDoc(
              reservation.ref,{
              active: false,
              status: RESERVATION_STATUS.DEAL_CANCELED
            })
          }
        }
      }

      /* ----------- ALGOLIA ----------- */
      // Get current indexed deals
      const restaurant = await algoliaIndex.getObject(deal.restaurantId, {
        attributesToRetrieve: ['deals']
      });
      let deals = [];
      if(restaurant.deals){
        deals = [...restaurant.deals]
      }

      // verify if deal is active
      if(!deal.active){
        deals = deals.filter((item) => item.id != snap.after.id)
      } else {
        deals = [...deals, {
          id: snap.after.id, 
          ...deal,
          dealType: deal.dealType == 1 ? 'discount' : 'promotion'
        }];
      }
      
      // create deal object
      const indexUpdate = {
        objectID: deal.restaurantId,
        deals,
        hasDeals: deals.length > 0
      };

      // Add or update new objects
      algoliaIndex
        .partialUpdateObject(indexUpdate)
        .then(() => {
          console.log("Documents updated into Algolia");
          process.exit(0);
        })
        .catch((error) => {
          console.error("Error when updateding documents into Algolia", error);
          process.exit(1);
        });
    });

  exports.onDeleteDeal = functions.firestore
    .document("Deals/{dealId}")
    .onDelete(async (snap, context) => {
      const deal = snap.data();

      // Cancel all reservations linked to the deal
      const reservationsCollection = query(
        collection(db, 'Reservations'),
        where('dealId', '==', snap.id),
        where('active', '==', true)
      );
      const reservations = await getDocs(reservationsCollection);
      
      if(reservations.size){
        for(const reservation of reservations.docs){
          await updateDoc(
            reservation.ref, {
            active: false,
            status: RESERVATION_STATUS.DEAL_CANCELED
          })
        }
      }

      // Get current indexed deals
      const restaurant = await algoliaIndex.getObject(deal.restaurantId, {
        attributesToRetrieve: ['deals']
      });
      let deals = [];
      if(restaurant.deals){
        deals = [...restaurant.deals]
      }

      // remove deal
      deals = deals.filter((item) => item.id != snap.id);
      
      // create deal object
      const indexUpdate = {
        objectID: deal.restaurantId,
        deals,
        hasDeals: deals.length > 0
      };

      // Add or update new objects
      algoliaIndex
        .partialUpdateObject(indexUpdate)
        .then(() => {
          console.log("Documents deleted from Algolia");
          process.exit(0);
        })
        .catch((error) => {
          console.error("Error when deleting documents from Algolia", error);
          process.exit(1);
        });
    });

  // Rating Events
  exports.onCreateRating = functions.firestore
    .document("RestaurantRatings/{ratingId}")
    .onCreate(async (snap, context) => {
      const ratingObject = snap.data();

      // Get collection
      const raitingRef = await getDocs(query(
        collection(db, `RestaurantRatings`),
        where('restaurantId', '==', ratingObject.restaurantId)
      ))
      .catch((err) => {
          console.error(err);
          return;
      });

      // Calculate restaurant rating
      let rating = 0;
      const ratingCount = raitingRef.size;
      if(ratingCount){ 
          let counterGroups = {
              'one': 0,
              'two': 0,
              'three': 0,
              'four': 0,
              'five': 0,
          }
          raitingRef.forEach(doc => {
              switch(doc.data().rate){
                  case 1:
                      counterGroups.one += 1;
                      break;
                  case 2:
                      counterGroups.two += 1;
                      break;
                  case 3:
                      counterGroups.three += 1;
                      break;
                  case 4:
                      counterGroups.four += 1;
                      break;
                  case 5:
                      counterGroups.five += 1;
                      break;
              }
          })
          rating = (
              1 * counterGroups.one
              + 2 * counterGroups.two
              + 3 * counterGroups.three
              + 4 * counterGroups.four
              +5 * counterGroups.five
          ) / (5 * ratingCount);
          rating *= 5;
      }

      // Add or update new objects
      algoliaIndex
        .partialUpdateObject({
          objectID: ratingObject.restaurantId,
          rating
        })
        .then(() => {
          console.log("Documents imported into Algolia");
          process.exit(0);
        })
        .catch((error) => {
          console.error("Error when importing documents into Algolia", error);
          process.exit(1);
        });
    });

  exports.onUpdateRating = functions.firestore
    .document("RestaurantRatings/{ratingId}")
    .onUpdate(async (snap, context) => {
      const ratingObject = snap.after.data();

      // Get collection
      const raitingRef = await getDocs(query(
        collection(db, `RestaurantRatings`),
        where('restaurantId', '==', ratingObject.restaurantId)
      )).catch((err) => {
          console.error(err);
          return;
      });

      // Calculate restaurant rating
      let rating = 0;
      const ratingCount = raitingRef.size;
      if(ratingCount){ 
          let counterGroups = {
              'one': 0,
              'two': 0,
              'three': 0,
              'four': 0,
              'five': 0,
          }
          raitingRef.forEach(doc => {
              switch(doc.data().rate){
                  case 1:
                      counterGroups.one += 1;
                      break;
                  case 2:
                      counterGroups.two += 1;
                      break;
                  case 3:
                      counterGroups.three += 1;
                      break;
                  case 4:
                      counterGroups.four += 1;
                      break;
                  case 5:
                      counterGroups.five += 1;
                      break;
              }
          })
          rating = (
              1 * counterGroups.one
              + 2 * counterGroups.two
              + 3 * counterGroups.three
              + 4 * counterGroups.four
              +5 * counterGroups.five
          ) / (5 * ratingCount);
          rating *= 5;
      }

      // Add or update new objects
      algoliaIndex
        .partialUpdateObject({
          objectID: ratingObject.restaurantId,
          rating
        })
        .then(() => {
          console.log("Documents imported into Algolia");
          process.exit(0);
        })
        .catch((error) => {
          console.error("Error when importing documents into Algolia", error);
          process.exit(1);
        });
    });

  exports.onDeleteRating = functions.firestore
    .document("RestaurantRatings/{ratingId}")
    .onDelete(async (snap, context) => {
      const ratingObject = snap.data();

      // Get collection
      const raitingRef = await getDocs(query(
        collection(db, `RestaurantRatings`),
        where('restaurantId', '==', ratingObject.restaurantId)
      )).catch((err) => {
          console.error(err);
          return;
      });

      // Calculate restaurant rating
      let rating = 0;
      const ratingCount = raitingRef.size;
      if(ratingCount){ 
          let counterGroups = {
              'one': 0,
              'two': 0,
              'three': 0,
              'four': 0,
              'five': 0,
          }
          raitingRef.forEach(doc => {
              switch(doc.data().rate){
                  case 1:
                      counterGroups.one += 1;
                      break;
                  case 2:
                      counterGroups.two += 1;
                      break;
                  case 3:
                      counterGroups.three += 1;
                      break;
                  case 4:
                      counterGroups.four += 1;
                      break;
                  case 5:
                      counterGroups.five += 1;
                      break;
              }
          })
          rating = (
              1 * counterGroups.one
              + 2 * counterGroups.two
              + 3 * counterGroups.three
              + 4 * counterGroups.four
              +5 * counterGroups.five
          ) / (5 * ratingCount);
          rating *= 5;
      }

      // Add or update new objects
      algoliaIndex
        .partialUpdateObject({
          objectID: ratingObject.restaurantId,
          rating
        })
        .then(() => {
          console.log("Documents imported into Algolia");
          process.exit(0);
        })
        .catch((error) => {
          console.error("Error when importing documents into Algolia", error);
          process.exit(1);
        });
    });
//}