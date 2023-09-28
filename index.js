require("dotenv").config();
const functions = require("firebase-functions");
const app = require("express")();
const bodyParser = require("body-parser");
const cors = require("cors");
const { collection, getDocs, query, updateDoc, where, addDoc, setDoc, doc, Timestamp } = require('firebase/firestore');
const algoliasearch = require("algoliasearch");
const dayjs = require("dayjs");

// Custom utils
const { db, adminDb } = require('./utils/admin');
const { USER_ROLES } = require('./utils/app-config');
const { isAuthenticated, isAuthorizated } = require("./utils/auth");
const { RESERVATION_STATUS } = require('./utils/reservations-utils');
const { syncRestaurantActiveDealsList } = require('./APIs/partners');
const {
  shouldPublishRestaurant
} = require("./utils/restaurant-utils");
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

// Import endpoints
const {
  getUserDeals,
  createUser,
  getUser,
  deleteUser,
  getUsers,
  getCurrentUser,
  getUserReservations,
  editUser,
  deactivateUser,
  isUsernameAvailable,
  registerDeviceToken
} = require("./APIs/users");
const {
  getPartnerRestaurant,
  getPartnerRestaurants,
  deactivatePartnerRestaurant,
  createRestaurant,
  editPartnerRestaurant,
  isRestaurantNameAvailable,
  uploadRestaurantProfilePhoto,

  getDeal,
  getDeals,
  createDeal,
  updateDeal,
  deleteDeal,
  getUniqueDealsByRedemptions,

  getReservationsList,
  getPartnerCurrentBalance,
  getPartnerBalanceHistory,
  getPartnerBillings,
  getPartnerBillingsDetails,

  createQR,

  getRestaurantMenus,
  postRestaurantMenu,
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
  getRestaurantDeal,
  getRestaurantDeals,
  getRestaurantGallery,
  searchRestaurants,
  postRestaurantPhoto,
  editRestaurant: editRestaurantGeneral,
  createRestaurant: createRestaurantGeneral,
  deleteRestaurant: deleteRestaurantGeneral
} = require("./APIs/restaurants");
const {
  getReservation,
  createReservation,
  cancelReservation,
} = require("./APIs/reservations");
const { 
  redeemDeal, 
  findDeal, 
  deleteAllDeals 
} = require("./APIs/deals");
const {
  addFavorite,
  getFavorites,
  removeFavorite,
} = require("./APIs/favorites");
const { 
  loginUser, 
  logoutUser, 
  verifyIdToken,
  resetPassword, 
  verificateUserEmail ,
  sendVerificationEmail
} = require("./APIs/auth");
const { 
  getAdminRestaurants,
  getAdminRestaurantsSummary,
  getAdminDeals,
  getAdminDealsSummary,
  getAdminReservations,
  getAdminReservationsSummary,
  getAdminUsersSummary,
  getBillings,
  updateBilling,
  createBilling,
  setUserRole, 
  syncAuthToFirestoreUsers,
  formatRedemptions,
  billingsPast,
  exportsPartnerBillings,
  exportsPartnerBillingDetails,
  searchRestaurantsBillings,
  createLastMonthBillings
} = require("./APIs/admin");


// Auth
app.post("/auth/login", loginUser);
app.post("/auth/logout", isAuthenticated, logoutUser);
app.post("/auth/verifyIdToken", verifyIdToken);
app.post("/auth/password-reset/:email", resetPassword);
app.post("/auth/email-verification/:userId", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), verificateUserEmail);
app.post("/auth/send-verification-email", sendVerificationEmail);

// Users
app.get("/users", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), getUsers);
app.post("/user", createUser);
app.get("/user", isAuthenticated, getCurrentUser);
app.delete("/user", isAuthenticated, deactivateUser);
app.get('/user/:userId', getUser);
app.put("/user/:userId", editUser);
app.delete("/user/:userId", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), deleteUser);
app.get("/user/:userId/deals", getUserDeals);
app.get("/user/:email/available", isUsernameAvailable);
app.get("/user/:userId/reservations", isAuthenticated, getUserReservations);
app.post("/user/:userId/registerDeviceToken", isAuthenticated, registerDeviceToken);

// Reservations
app.get("/reservations/:reservationId", isAuthenticated, getReservation);
app.post("/reservations", isAuthenticated, createReservation);
app.delete("/reservations/:reservationId", isAuthenticated, cancelReservation);

// Partners
app.post("/partner/createQR", isAuthenticated, createQR);
app.get("/partner/restaurants", isAuthenticated, getPartnerRestaurants);
app.get("/partner/restaurant/:restaurantId", isAuthenticated, getPartnerRestaurant);
app.delete("/partner/restaurant/:restaurantId", isAuthenticated, deactivatePartnerRestaurant);
app.put("/partner/restaurant/:restaurantId", isAuthenticated, editPartnerRestaurant);
app.get("/partner/restaurant/:restaurantId/deals", isAuthenticated, getDeals);
app.get("/partner/restaurant/:restaurantId/deals/redemptions", isAuthenticated, getUniqueDealsByRedemptions);
app.get("/partner/restaurant/:restaurantId/deal/:dealId", isAuthenticated, getDeal);
app.put("/partner/restaurant/:restaurantId/deal/:dealId", isAuthenticated, updateDeal);
app.delete("/partner/restaurant/:restaurantId/deal/:dealId", isAuthenticated, deleteDeal);
app.post("/partner/restaurant/:restaurantId/deal", isAuthenticated, createDeal);
app.get("/partner/restaurant/:restaurantId/reservations", isAuthenticated, getReservationsList);
app.get("/partner/restaurant/:restaurantId/menus", isAuthenticated, getRestaurantMenus);
app.post("/partner/restaurant/:restaurantId/menu", isAuthenticated, postRestaurantMenu);
app.post("/partner/restaurant/:restaurantId/image", isAuthenticated, uploadRestaurantProfilePhoto);
app.get("/partner/restaurant/:restaurantId/photos", getRestaurantGallery);
app.get("/partner/restaurant/:restaurantId/balance", isAuthenticated, getPartnerCurrentBalance );
app.get("/partner/restaurant/:restaurantId/balance/history", isAuthenticated, getPartnerBalanceHistory );
app.get("/partner/restaurant/:restaurantId/billings", isAuthenticated, getPartnerBillings);

app.get("/categories", getCategories);
app.post("/categories", isAuthenticated, createCategory);
app.post("/restaurant/create", isAuthenticated, createRestaurant);
app.get(
  "/restaurant/:restaurantName/available-name",
  isRestaurantNameAvailable
);

// Restaurants
app.get("/restaurants", getRestaurants);
app.get("/restaurant", getRestaurant);
app.post("/restaurant", isAuthenticated, createRestaurantGeneral);
app.get("/restaurant/:restaurantId", getRestaurant);
app.delete("/restaurant/:restaurantId", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), deleteRestaurantGeneral);
app.put("/restaurant/:restaurantId", isAuthenticated, editRestaurantGeneral);
app.get("/restaurant/:restaurantId/deals", getRestaurantDeals);
app.get("/restaurant/:restaurantId/deals/:dealId", getRestaurantDeal);
app.get("/restaurant/:restaurantId/photos", getRestaurantGallery);
app.post("/restaurant/:restaurantId/photo", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), postRestaurantPhoto);

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
app.post("/admin/restaurants", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), getAdminRestaurants);
app.get("/admin/restaurants/summary", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), getAdminRestaurantsSummary);
app.get("/admin/deals/", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), getAdminDeals);
app.get("/admin/deals/summary", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), getAdminDealsSummary);
app.get("/admin/users/summary", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), getAdminUsersSummary);
app.get("/admin/reservations/", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), getAdminReservations);
app.get("/admin/reservations/summary", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), getAdminReservationsSummary);
app.post("/admin/redemptions", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), formatRedemptions);
app.post("/admin/billings-past", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), billingsPast);
app.post("/admin/billing", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), createBilling);
app.get("/admin/billings/restaurant/:restaurantId", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), getBillings);
app.put("/admin/billing/:billingId", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), updateBilling);
app.get("/admin/billings/export/:restaurantId", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), exportsPartnerBillings);
app.get("/admin/billings/details/export/:restaurantId", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), exportsPartnerBillingDetails);
app.post("/admin/billings/search", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), searchRestaurantsBillings);
app.post("/admin/setUserRole", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] }), setUserRole);
app.post("/admin/syncAuthToFirestoreUsers", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.SUPER_ADMIN] }), syncAuthToFirestoreUsers);
app.post("/admin/createLastMonth", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.SUPER_ADMIN] }), createLastMonthBillings);

// Utils
app.post("/import/restaurants", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.SUPER_ADMIN] }), importRestaurants);
app.put("/update/restaurants", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.SUPER_ADMIN] }), updateAllRestaurants);
//app.post('/deals/deleteAllDeals', isAuthenticated, deleteAllDeals); // <------ DAnGEROUS UTILITY
//app.get('/deals-status', isAuthenticated, updateDealStatus) // <-- UTILITY
//app.put('/update/reservations', isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.SUPER_ADMIN] }), require('./APIs/admin').updateAllReservations); // <-- UTILITY
//app.put('/update/deals', isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.SUPER_ADMIN] }), require('./APIs/admin').updateAllDeals); // <-- UTILITY
//app.put('/update/users', isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.SUPER_ADMIN] }), require('./APIs/admin').updateAllUsers); // <-- UTILITY
app.post("/push-notifications/", isAuthenticated, isAuthorizated({ hasRole: [USER_ROLES.SUPER_ADMIN] }), require('./utils/push-notifications/customer').sendPushNotification);

// Generic Error Handler
const handleError = async (err, req, res) => {
  console.log(err);
  return res.status(err.status).json({ ...err, message: err.message });
}
app.use(handleError);

// Export API endpoints
exports.api = functions.https.onRequest(app);


////////////////////////////////////////
// CronJobs
exports.updateDealStatus = functions.pubsub
  .schedule("*/10 * * * *")
  .timeZone("America/Mexico_City")
  .onRun(updateDealStatus);

exports.updateReservationStatus = functions.pubsub
  .schedule("*/5 * * * *")
  .timeZone("America/Mexico_City")
  .onRun(updateReservationStatus);

exports.createBillings = functions.pubsub
  .schedule("0 0 1 * *")
  .timeZone("America/Mexico_City")
  .onRun(createLastMonthBillings);


////////////////////////////////////////
// Restaurants Events
//if(NODE_ENV == 'production'){
  exports.onCreateUser = functions.auth
    .user()
    .onCreate(async (user) => {
      await adminDb.collection('Users').doc(user.uid).set({
        authId: user.uid,
        email: user.email,
        firstName: user.displayName,
        lastName: user.displayName,
        role: user.customClaims ? user.customClaims.role : USER_ROLES.CUSTOMER,
        createdAt: dayjs().toDate(),
        updatedAt: dayjs().toDate()
      }).catch((err) => {
        console.log(err);
      })
    });
  exports.onCreateRestaurant = functions.firestore
    .document("Restaurants/{restaurantId}")
    .onCreate(async (snap) => {
      const restaurant = snap.data();
    });

  exports.onUpdateRestaurant = functions.firestore
    .document("Restaurants/{restaurantId}")
    .onUpdate(async (snap) => {
      const restaurantId = snap.after.id;
      const { location, ...restaurant } = snap.after.data();
      const hasPhoto = Boolean(restaurant?.photo && restaurant?.photo !== '');
      const hasAvatar = Boolean(restaurant?.avatar && restaurant?.avatar !== '');
      
      // Format deals
      let dealsStartsDates = [];
      const deals = restaurant.deals ? restaurant.deals.map((deal) => {
        // Validate dates
        const startsAt = deal.startsAt.toDate
          ? dayjs(deal.startsAt.toDate()).unix()
          : dayjs(deal.startsAt).unix();
        const expiresAt = deal.expiresAt.toDate
          ? dayjs(deal.expiresAt.toDate()).unix()
          : dayjs(deal.expiresAt).unix();
        const createdAt = deal.createdAt.toDate
          ? dayjs(deal.createdAt.toDate()).unix()
          : dayjs(deal.createdAt).unix();

        dealsStartsDates.push(startsAt);
        return {
          ...deal,
          recurrenceSchedules: deal.recurrenceSchedules.map(schedule => {
            return {
              ...schedule,
              startsAt: startsAt,
              expiresAt: expiresAt,
            }
          }),
          startsAt: startsAt,
          expiresAt: expiresAt,
          createdAt: createdAt,
        }
      }) : [];
      dealsStartsDates = dealsStartsDates.sort((a, b) => {return a-b});
      dealsStartsDates = dealsStartsDates.slice(0, 1)
      const hasDeals = deals.length > 0;

      // Geolocation
      if(parseFloat(location?.longitude) && parseFloat(location?.latitude)){
        restaurant._geoloc = {
          lng: parseFloat(location.longitude),
          lat: parseFloat(location.latitude)
        }
      }
      
      /*--------------------- ALGOLIA ---------------------*/
      // Create updated object
      const updatedRestaurant = {
        ...restaurant,
        createdAt: restaurant.createdAt._seconds,
        location,
        hasPhoto: hasPhoto,
        hasAvatar: hasAvatar,
        hasDeals,
        deals,
        dealsStartsDates,
        id: restaurantId,
        objectID: restaurantId
      };

      // // Add or update new objects
      await algoliaIndex
        .partialUpdateObject(updatedRestaurant, {
          createIfNotExists: true
        }).catch((error) => {
          console.error("Error when updating the document in Algolia", error);
          process.exit(1);
        });

      // 
      console.log("Finished updating restuarant.");
      return
    });
  exports.onDeleteRestaurant = functions.firestore
    .document("Restaurants/{restaurantId}")
    .onDelete(async (snap) => {
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
    .onCreate(async (snap) => {
      const deal = snap.data();

      // Sync restaurant deals list
      let deals = [];
      deals = await syncRestaurantActiveDealsList(deal.restaurantId)
      .catch((err) => {
        deals = [];
        console.error("Error al actualizar la el restaurante.", err);
        // process.exit(1);
      });
      if(deal.active){
        deals.push(deal);
      }
      
      // Finish Process
      console.log("Finished creating deals.");
      return
    });

  exports.onUpdateDeal = functions.firestore
    .document("Deals/{dealId}")
    .onUpdate(async (snap) => {
      const deal = snap.after.data();

      // Sync restaurant deals list
      let deals = [];
      deals = await syncRestaurantActiveDealsList(deal.restaurantId)
      .catch((err) => {
        deals = [];
        console.error("Error al actualizar el restaurante.", err);
        // process.exit(1);
      });
      
      // Finish process
      console.log("Finished updating deals.");
      return
    });

  exports.onDeleteDeal = functions.firestore
    .document("Deals/{dealId}")
    .onDelete(async (snap) => {
      const deal = snap.data();

      // Sync restaurant deals list
      let deals = [];
      deals = await syncRestaurantActiveDealsList(deal.restaurantId)
      .catch((err) => {
        deals = [];
        console.error("Error al actualizar la el restaurante.", err);
        // process.exit(1);
      });
      
      /*
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
        }); */

      // Finish process
      console.log("Finished deleting deals.");
      return
    });

  // Rating Events
  exports.onCreateRating = functions.firestore
    .document("RestaurantRatings/{ratingId}")
    .onCreate(async (snap) => {
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
    .onUpdate(async (snap) => {
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
    .onDelete(async (snap) => {
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