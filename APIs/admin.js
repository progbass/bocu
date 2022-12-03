const {
  createUserWithEmailAndPassword,
  sendEmailVerification,
} = require("firebase/auth");
const { auth, db, adminAuth } = require("../utils/admin");
const {
  doc,
  addDoc,
  getDoc,
  setDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  collection,
  orderBy,
  where,
  query,
  limit,
  Timestamp,
} = require("firebase/firestore");
const functions = require("firebase-functions");
const dayjs = require("dayjs");
const { user } = require("firebase-functions/v1/auth");
const { getNewBillingObject } = require("../utils/billing-utils");
const { USER_ROLES, DEFAULT_TAKE_RATE, LISTING_CONFIG } = require("../utils/app-config");
const { signIn } = require("./auth");
const { response } = require("express");

function handleError(res, err) {
  return res.status(500).send({ message: `${err.code} - ${err.message}` });
}

//
exports.setUserRole = async (req, res) => {
  try {
    const { uid, role } = req.body;

    // Validate fields
    if (!uid) {
      return res.status(400).send({ message: "Missing user ID." });
    }
    if (!role || !Object.values(USER_ROLES).includes(role)) {
      return res.status(400).send({ message: "User role not defined." });
    }

    // Define user role in firebase Auth
    await adminAuth.setCustomUserClaims(uid, { role });

    // Resturn modified user
    const userAuth = await adminAuth.getUser(uid);
    return res.json({
      ...userAuth.toJSON(),
    });
  } catch (err) {
    return handleError(res, err);
  }
};
exports.editUser = async (request, response) => {
  const user = await adminAuth
    .updateUser(request.params.userId, {
      ...request.body,
    })
    .catch((err) => {
      return response.status(404).json({ message: "Usuario no encontrado." });
    });

  //
  if (user) {
    // Get Users firestore node
    const userDoc = await getDoc(doc(db, "Users", user.uid));
    const userNode = userDoc.data() ? userDoc.data() : {};

    //
    return response.json({ ...user.toJSON(), ...userNode });
  }
  //
  return response.status(404).json({ message: "Usuario no encontrado." });

  // updateDoc(
  // 	doc(db, `/Users/`, request.params.userId),
  // 	request.body
  // ).then((doc) => {
  // 		response.json({message: 'Updated successfully'});
  // 	})
  // 	.catch((err) => {
  // 		console.error(error);
  // 		return response.status(500).json({
  // 			message: "Cannot Update the value"
  // 		});
  // 	});
};
exports.deleteUser = async (request, response) => {
  // Get user authId
  const userDoc = doc(db, "Users", request.params.userId);
  const user = await getDoc(userDoc);

  // Remove user from firestore
  await deleteDoc(userDoc).catch((err) => {
    return response.status(500).json({
      ...err,
      message: 'Error al eliminar el usuario.',
    });
  });

  // Remove from Firebase Authentication module
  let authError = "";

  try {
    await adminAuth.deleteUser(user.get("authId"));
  } catch (err) {
    console.error(err);
    authError = err;
    // return response.status(500).json({
    //     error: err.code
    // });
  }

  return response.status(200).json({ message: "Success", error: authError });
};

// Billing
const createRestaurantBilling = async (restaurantId, periodStart, periodEnd, manualAdjustment = 0) => {
  // Get restaurant
  const restaurant = await getDoc(
    doc(db, "Restaurants", restaurantId)
  ).catch((err) => {
    throw new Error("Restaurante no encontrado.");
  });

  // Get Redemptions
  const redemptionsQuery = query(
    collection(db, "DealRedemptions"),
    where("restaurantId", "==", restaurantId),
    where("createdAt", ">=", dayjs(periodStart).toDate()),
    where("createdAt", "<=", dayjs(periodEnd).toDate()),
    orderBy("createdAt", "desc")
  )
  const redemptions = await getDocs(redemptionsQuery).catch((err) => {
    throw new Error("Error al obtener las ofertas.");
  });

  // Calculate balance
  let calculatedBalance = 0;
  redemptions.docs.forEach((redemption) => {
    const averageTicket = redemption.get("averageTicket") ? parseFloat(redemption.get("averageTicket")) : 0;
    const takeRate = redemption.get("takeRate") ? parseFloat(redemption.get("takeRate")) : DEFAULT_TAKE_RATE;
    calculatedBalance += averageTicket * takeRate;
  });

  // Calculate total balance
  const totalBalance = calculatedBalance + manualAdjustment;

  // Billing object model
  const billing = getNewBillingObject(
    restaurant.id,
    dayjs(periodStart).toDate(),
    dayjs(periodEnd).toDate(),
    {
      redemptions: redemptions.docs.map((deal) => deal.id),  
      calculatedBalance,
      manualAdjustment,
      totalBalance,
    }
  );

  // Create billing
  const billingDoc = await addDoc(collection(db, "Billings"), billing).catch((err) => {
    throw new Error("Error al crear la facturación.");
  });
  const newBilling = await getDoc(billingDoc).catch((err) => {
    throw new Error("Error al obtener la facturación.");
  });

  return newBilling
}
exports.createBilling = async (request, response) => {
  const restaurantId = request.body.restaurantId;
  const billingPeriodStart = request.body.periodStart;
  const billingPeriodEnd = request.body.periodEnd;
  const manualAdjustment = request.body.manualAdjustment ? request.body.manualAdjustment : 0;

  // Validations
  if(!restaurantId) {
    return response.status(400).json({ message: "ID del restaurante obligatorio." });
  }
  if(!billingPeriodStart){
    return response.status(400).json({
      message: 'No se encontró la fecha de inicio facturación.'
    });
  }
  if(!dayjs(billingPeriodStart).isValid()) {
    return response.status(400).json({
      message: 'Fecha de inicio facturación inválida.'
    });
  }
  if(!billingPeriodEnd){
    return response.status(400).json({
      message: 'No se encontró la fecha de fin facturación.'
    });
  }
  if(!dayjs(billingPeriodEnd).isValid()) {
    return response.status(400).json({
      message: 'Fecha de fin facturación inválida.'
    });
  }
  if(manualAdjustment && isNaN(manualAdjustment)){
    return response.status(400).json({
      message: 'Ajuste manual inválido.'
    });
  }

  // Create billing
  const billing = await createRestaurantBilling(
    restaurantId, 
    billingPeriodStart, 
    billingPeriodEnd, 
    manualAdjustment
  ).catch((err) => {
    return response.status(500).json({
      message: err.message
    });
  });

  // Return new object
  return response.json({
    id: billing.id,
    ...billing.data(),
    periodStart: billing.get("periodStart").toDate(),
    periodEnd: billing.get("periodEnd").toDate(),
    createdAt: billing.get("createdAt").toDate()
  });
}
exports.getBillings = async (request, response) => {
  const restaurantId = request.params.restaurantId;
  const billingPeriodStart = request.query.periodStart;
  const billingPeriodEnd = request.query.periodEnd;
  const manualAdjustment = request.query.manualAdjustment ? request.query.manualAdjustment : 0;
  const filtersList = [];

  // Validations
  if(!restaurantId) {
    return response.status(400).json({ message: "ID del restaurante obligatorio." });
  }
  if(billingPeriodStart && dayjs(billingPeriodStart).isValid()) {
    filtersList.push(where("periodStart", ">=", dayjs(billingPeriodStart).toDate()))
  }
  let filterByPeriodEnd = false;
  if(billingPeriodEnd && dayjs(billingPeriodEnd).isValid()) {
    filterByPeriodEnd = true;
    // filtersList.push(where("periodEnd", "<=", dayjs(billingPeriodEnd).toDate()))
  }
  if(manualAdjustment && isNaN(manualAdjustment)){
    return response.status(400).json({
      message: 'Ajuste manual inválido.'
    });
  }

  // Get restaurant
  const restaurantDoc = doc(db, "Restaurants", restaurantId);
  const restaurant = await getDoc(restaurantDoc).catch((err) => {
    return response.status(404).json({ message: "Restaurante no encontrado." });
  });

  // Get Billings
  const billingsQuery = query(
    collection(db, "Billings"), 
    where("restaurantId", "==", restaurant.id),
    ...filtersList
  );
  const billings = await getDocs(billingsQuery).catch((err) => {
    console.log(err)
    return response.status(500).json({ message: "Error al obtener las facturaciones." });
  });

  if(billings.empty){
    return response.status(200).json([]);
  }

  // Return
  return response.json(billings.docs.reduce((billingList, billing) => {
    if(filterByPeriodEnd && dayjs(billing.get("periodEnd").toDate()).isAfter(dayjs(billingPeriodEnd))){
      return billingList
    }

    return [
      ...billingList,
      {
        id: billing.id,
        ...billing.data(),
        createdAt: billing.data().createdAt.toDate(),
        periodStart: billing.data().periodStart.toDate(),
        periodEnd: billing.data().periodEnd.toDate(),
        paidAt: billing.data().paidAt ? billing.data().paidAt.toDate() : null,
      }
    ]
  }, []));
}
exports.updateBilling = async (request, response) => {
  /*
  const billingId = request.params.billingId;
  //const redemptions = request.body.redemptions || [];
  const billingPeriodStart = request.body.periodStart;
  const billingPeriodEnd = request.body.periodEnd;
  const manualAdjustment = request.body.manualAdjustment ? request.body.manualAdjustment : 0;

  // Validations
  if(!restaurantId) {
    return response.status(400).json({ message: "ID del restaurante obligatorio." });
  }
  if(!billingPeriodStart){
    return response.status(400).json({
      message: 'No se encontró la fecha de inicio facturación.'
    });
  }
  if(!dayjs(billingPeriodStart).isValid()) {
    return response.status(400).json({
      message: 'Fecha de inicio facturación inválida.'
    });
  }
  if(!billingPeriodEnd){
    return response.status(400).json({
      message: 'No se encontró la fecha de fin facturación.'
    });
  }
  if(!dayjs(billingPeriodEnd).isValid()) {
    return response.status(400).json({
      message: 'Fecha de fin facturación inválida.'
    });
  }
  if(manualAdjustment && isNaN(manualAdjustment)){
    return response.status(400).json({
      message: 'Ajuste manual inválido.'
    });
  }

  // Get restaurant
  const restaurantDoc = doc(db, "Restaurants", restaurantId);
  const restaurant = await getDoc(restaurantDoc).catch((err) => {
    return response.status(404).json({ message: "Restaurante no encontrado." });
  });

  // Get Deals
  const redemptionsQuery = query(
    collection(db, "DealRedemptions"),
    where("restaurantId", "==", restaurant.id),
    where("createdAt", ">=", dayjs(billingPeriodStart).toDate()),
    where("createdAt", "<=", dayjs(billingPeriodEnd).toDate()),
    orderBy("createdAt", "desc")
  )
  const redemptions = await getDocs(redemptionsQuery).catch((err) => {
    console.log(err)
    return response.status(500).json({ message: "Error al obtener las ofertas." });
  });

  // Calculate balance
  let calculatedBalance = 0;
  redemptions.docs.forEach((redemption) => {
    const averageTicket = redemption.get("averageTicket") ? parseFloat(redemption.get("averageTicket")) : 0;
    const takeRate = redemption.get("takeRate") ? parseFloat(redemption.get("takeRate")) : DEFAULT_TAKE_RATE;
    calculatedBalance += averageTicket * takeRate;
  });

  // Calculate total balance
  const totalBalance = calculatedBalance + manualAdjustment;

  // Billing object model
  const billing = getNewBillingObject(
    restaurant.id,
    dayjs(billingPeriodStart).toDate(),
    dayjs(billingPeriodEnd).toDate(),
    {
      redemptions: redemptions.docs.map((deal) => deal.id),  
      calculatedBalance,
      manualAdjustment,
      totalBalance,
    }
  );

  // Create billing
  const billingDoc = await addDoc(collection(db, "Billings"), billing).catch((err) => {
    return response.status(500).json({ message: "Error al crear la facturación." });
  });
  const newBilling = await getDoc(billingDoc).catch((err) => {
    return response.status(500).json({ message: "Error al obtener la facturación." });
  });

  // Return new object
  return response.json({
    id: newBilling.id,
    ...newBilling.data(),
    periodStart: newBilling.get("periodStart").toDate(),
    periodEnd: newBilling.get("periodEnd").toDate(),
    createdAt: newBilling.get("createdAt").toDate()
  }*/
};

//
exports.syncAuthToFirestoreUsers = async (req, res) => {
  try {
    const usersAuth = await adminAuth.listUsers();
    if(usersAuth.users.length > 0) {
      usersAuth.users.forEach(async (user) => {
        const userDoc = await getDoc(doc(db, "Users", user.uid));
        if(!userDoc.exists()) {
          await setDoc(doc(db, "Users", user.uid), {
            authId: user.uid,
            email: user.email,
            firstName: user.displayName ? user.displayName : '',
            lastName: user.lastName ? user.lastName : '',
            role: user.customClaims ? user.customClaims.role : USER_ROLES.CUSTOMER,
            createdAt: dayjs().toDate(),
            updatedAt: dayjs().toDate()
          }).catch((err) => {
            console.log(err);
          });
        }
      });
    }
    // Response
    return res.json({
      message: "Synced successfully"
    });
  } catch (err) {
    functions.logger.error(err);
    return handleError(res, err);
  }
};
exports.formatRedemptions = async (request, response) => {
  const redemptions = await getDocs(collection(db, "DealRedemptions"));
  for(const redemption of redemptions.docs) {
    const deal = await getDoc(
      doc(db, "Deals", redemption.get("dealId"))
    ).catch((err) => { console.log(err); return response.status(500) });
    
    if(!deal.exists()) {
      console.log('Deal does not exists. Deleting redemption...');
      deleteDoc(doc(db, "DealRedemptions", redemption.id));
      continue
    }
    
    const restaurant = await getDoc(doc(db, "Restaurants", deal.get("restaurantId")))
      .catch((err) => { console.log(err); return response.status(500) });

    await updateDoc(redemption.ref, {
      takeRate: .1,
      averageTicket: redemption.get("averageTicket") ? redemption.get("averageTicket") : 100,
      restaurantId: redemption.get("restaurantId") ? redemption.get("restaurantId") : restaurant.id,
    }).catch((err) => { console.log(err); return response.status(500) });
  }

  return response.status(200);
}
exports.billingsPast = async (request, response) => {
  const initialMonth = 6;
  const restaurants = await getDocs(collection(db, "Restaurants"));

  // Loop through restaurants
  for(const restaurant of restaurants.docs) {
    // Loop through months sequentially
    for(let currentMonth = initialMonth; currentMonth < dayjs().get('month'); currentMonth++) {
      const currentPeriod = dayjs().set('month', currentMonth);
      const periodStart = currentPeriod.startOf('month');
      const periodEnd = currentPeriod.endOf('month');
      
      // Create billing for corresponding period
      await createRestaurantBilling(restaurant.id, periodStart, periodEnd)
        .catch((err) => { 
          return response.status(500).json({ message: err.message });
         });
    }
  }

  return response.json({message: 'Done'});
}
