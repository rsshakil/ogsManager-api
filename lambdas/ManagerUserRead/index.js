/**
* @type {import('@types/aws-lambda').APIGatewayProxyHandler}
*/
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const commonFunctions = require("./commonFunctions/getWhereFromFilter");
const commonFunctions1 = require("./commonFunctions/convertToMySQLSort");
const ssm = new AWS.SSM();

const PAGES_VISITED = 0;
const ITEMS_PER_PAGE = 500;

const mapperKey = {
	userStatus: "User.userStatus",
	userDirectionId: "User.userDirectionId",
	countryName: "User.userCountryId",
	languageName: "Language.languageName",
	userId: "User.userId",
	userEmail: "User.userEmail",
	userSMSFlag: "User.userSMSFlag",
	userBillingFlag: "User.userBillingFlag",
	userTestUserFlag: "User.userTestUserFlag",
	userUUID: "User.userUUID",
	userInvitationCode: "User.userInvitationCode",
	userSMSTelNo: "User.userSMSTelNo",
	userCreatedAt: "User.userCreatedAt",
	userLastActiveAt: "User.userLastActiveAt",
	userLastLoginAt: "User.userLastLoginAt",
	userRegistIPAddress: "User.userRegistIPAddress",
	userSMSAuthenticatedAt: "User.userSMSAuthenticatedAt",

	userShippingName: 'COALESCE(d.userShippingName, a.userShippingName)',
	userShippingZipcode: 'COALESCE(d.userShippingZipcode, a.userShippingZipcode)',
	userShippingAddress: 'COALESCE(d.userShippingAddress, a.userShippingAddress)',
	userShippingAddress2: 'COALESCE(d.userShippingAddress2, a.userShippingAddress2)',
	userShippingAddress3: 'COALESCE(d.userShippingAddress3, a.userShippingAddress3)',
	userShippingAddress4: 'COALESCE(d.userShippingAddress4, a.userShippingAddress4)',
	userShippingTelCountryCode: 'COALESCE(d.userShippingTelCountryCode, a.userShippingTelCountryCode)',
	userShippingTel: 'COALESCE(d.userShippingTel, a.userShippingTel)',
};
const havingKeys = ["userCollectionCount", "remainingConvertablePoint", "userPointNowPoint", "referralCount"];

/**
* ManagerAppRead.
*
* @param {*} event
* @returns {json} response
*/
exports.handler = async (event) => {
	console.log("Event data:", event);
	// Reading encrypted environment variables --- required
	if (process.env.DBINFO == null) {
		const ssmreq = {
			Name: "PS_" + process.env.ENV,
			WithDecryption: true,
		};
		const ssmparam = await ssm.getParameter(ssmreq).promise();
		const dbinfo = JSON.parse(ssmparam.Parameter.Value);
		process.env.DBWRITEENDPOINT = dbinfo.DBWRITEENDPOINT;
		process.env.DBREADENDPOINT = dbinfo.DBREADENDPOINT;
		process.env.DBUSER = dbinfo.DBUSER;
		process.env.DBPASSWORD = dbinfo.DBPASSWORD;
		process.env.DBDATABSE = dbinfo.DBDATABSE;
		process.env.DBPORT = dbinfo.DBPORT;
		process.env.DBCHARSET = dbinfo.DBCHARSET;
		process.env.DBINFO = true;
	}

	// Database info
	const readDbConfig = {
		host: process.env.DBREADENDPOINT,
		user: process.env.DBUSER,
		password: process.env.DBPASSWORD,
		database: process.env.DBDATABSE,
		charset: process.env.DBCHARSET,
	};

	let parameter = [];
	let mysql_con;
	let response;

	try {
		// mysql connect
		mysql_con = await mysql.createConnection(readDbConfig);

		const { queryStringParameters = null, pathParameters = null } = event || {};

		const sql_user_point_subquery = `SELECT COALESCE(SUM(pointWalletPoint), 0) AS userPointNowPoint FROM PointWallet WHERE pointWalletUserId = User.userId`;

		const sql_user_collection_count = `SELECT COUNT(userCollectionId) AS userCollectionCount FROM UserCollection WHERE userCollectionUserId = User.userId AND userCollectionStatus = 1`;

		const sql_user_collection_convertable_point = `SELECT COALESCE(SUM(userCollectionPoint), 0) AS remainingConvertablePoint FROM UserCollection WHERE userCollectionUserId = User.userId AND userCollectionStatus = 1`;

		//get list
		if (pathParameters === null) {
			const {
				skip: offset = PAGES_VISITED,
				take: limit = ITEMS_PER_PAGE,
				filter,
				sort,
			} = queryStringParameters || {};

			let where = "";
			let having = "";
			console.log("filter", filter);
			if (filter) {
				const {
					condition = "",
					conditionParameters = [],
					havingCondition = "",
					havingConditionParameters = [],
				} = commonFunctions.getWhereFromFilter(filter, mapperKey, havingKeys);

				if (condition) {
					where = condition;
					parameter = [...parameter, ...conditionParameters];
				}

				if (havingCondition) {
					having = havingCondition;
					parameter = [...parameter, ...havingConditionParameters];
				}
			}

			//addWhere userRegistFlag=1 #114023
			if (where) {
				where = `${where} AND User.userRegistFlag = 1`;
			} else {
				where = ` where User.userRegistFlag = 1`;
			}

			console.log("where >>", where);

			let orderBy = commonFunctions1.convertToMySQLSort(sort, "userCreatedAt DESC");

			//const sql_user_referral_count = `SELECT COUNT(*) AS referralCount FROM User AS r WHERE r.userInvitationCode = User.userId`;
			// const sql_user_referral_count = `0`;

			const sql_count = `
				SELECT COUNT(*) AS total_rows FROM (
					SELECT 
						(${sql_user_point_subquery}) AS userPointNowPoint,  
						(${sql_user_collection_count}) AS userCollectionCount,
						(${sql_user_collection_convertable_point}) AS remainingConvertablePoint,
						COUNT(r.userId) AS referralCount,
						User.userLanguageId,
						Language.languageName
					FROM User
					LEFT OUTER JOIN (
						SELECT 
							userShippingUserId, 
							userShippingName, 
							userShippingZipcode, 
							userShippingAddress, 
							userShippingAddress2, 
							userShippingAddress3, 
							userShippingAddress4, 
							userShippingTelCountryCode,
							userShippingTel
						FROM UserShipping AS a1
						WHERE userShippingId = (SELECT MAX(userShippingId) FROM UserShipping WHERE a1.userShippingUserId = userShippingUserId)
					) a ON userId = a.userShippingUserId
					LEFT OUTER JOIN UserShipping d ON User.userId = d.userShippingUserId AND d.userShippingPriorityFlag = 1
					LEFT OUTER JOIN UserPoint ON userPointUserId = User.userId
					LEFT OUTER JOIN (SELECT userId, userInvitationCode FROM User WHERE userInvitationCode IS NOT NULL) AS r ON r.userInvitationCode = User.userId
					LEFT OUTER JOIN Language ON languageId = User.userLanguageId
					${where}
					GROUP BY User.userId
					${having}
				) AS c1`;

			console.log("count sql ", sql_count);

			const [query_result_count] = await mysql_con.query(sql_count, parameter);

			// userPointLastPurchaseAtの取り方が違うので後で修正する必要があり
			const sql_data = `
				SELECT 
					User.userId,
					User.userStatus,
					User.userDirectionId,
					User.userSMSTelNo,
					User.userSMSFlag,
					User.userCountryId,
					User.userAFCode,
					User.userLanguageId,
					User.userBillingFlag,
					User.userTestUserFlag,
					Language.languageName,
					User.userInvitationCode,
					countryName,
					BIN_TO_UUID(User.userUUID) AS userUUID,
					User.userEmail,
					COALESCE(d.userShippingName, a.userShippingName) AS userShippingName,
					COALESCE(d.userShippingZipcode, a.userShippingZipcode) AS userShippingZipcode,
					COALESCE(d.userShippingAddress, a.userShippingAddress) AS userShippingAddress,
					COALESCE(d.userShippingAddress2, a.userShippingAddress2) AS userShippingAddress2,
					COALESCE(d.userShippingAddress3, a.userShippingAddress3) AS userShippingAddress3,
					COALESCE(d.userShippingAddress4, a.userShippingAddress4) AS userShippingAddress4,
					COALESCE(d.userShippingTelCountryCode, a.userShippingTelCountryCode) AS userShippingTelCountryCode,
					COALESCE(d.userShippingTel, a.userShippingTel) AS userShippingTel,
					userPointUsagePoint,
					userPointExchangePoint,
					userPointPurchasePoint,
					userPointPurchasePointStripeCredit,
					userPointPurchasePointStripeBank,
					userPointPurchasePointEpsilonCredit,
					userPointPurchasePointEpsilonBank,
					userPointPurchasePointEpsilonPaypay,
					userPointPurchasePointPaypay,
					userPointPurchasePointManualBank,
					userPointPurchaseValue,
					userPointPurchaseValueStripeCredit,
					userPointPurchaseValueStripeBank,
					userPointPurchaseValueEpsilonCredit,
					userPointPurchaseValueEpsilonBank,
					userPointPurchaseValueEpsilonPaypay,
					userPointPurchaseValuePaypay,
					userPointPurchaseValueManualBank,
					userPointCouponPoint,
					userPointPresentPoint,
					userPointSystemAdditionPoint,
					userPointSystemSubtractionPoint,
					userPointLostPoint,
					userPointShippingPoint,
					userPointShippingRefundPoint,
					userPointPurchaseCount,
					userPointLastGachaAt*1000 AS userPointLastGachaAt,
					userPointLastPurchaseAt*1000 AS userPointLastPurchaseAt,
					User.userCreatedAt*1000 AS userCreatedAt,
					User.userLastActiveAt*1000 AS userLastActiveAt,
					User.userLastLoginAt*1000 AS userLastLoginAt,
					User.userUpdatedAt*1000 AS userUpdatedAt,
					(${sql_user_point_subquery}) AS userPointNowPoint,  
					(${sql_user_collection_count}) AS userCollectionCount,
					(${sql_user_collection_convertable_point}) AS remainingConvertablePoint,
					COUNT(r.userId) AS referralCount,
					User.userRegistIPAddress,
					User.userSMSAuthenticatedAt*1000 AS userSMSAuthenticatedAt
				FROM User
				LEFT OUTER JOIN Country ON countryId = userCountryId
				LEFT OUTER JOIN (
					SELECT 
						userShippingUserId, 
						userShippingName, 
						userShippingZipcode, 
						userShippingAddress, 
						userShippingAddress2, 
						userShippingAddress3, 
						userShippingAddress4, 
						userShippingTelCountryCode,
						userShippingTel
					FROM UserShipping AS a1
					WHERE userShippingId = (SELECT MAX(userShippingId) FROM UserShipping WHERE a1.userShippingUserId = userShippingUserId)
				) a ON userId = a.userShippingUserId
				LEFT OUTER JOIN UserShipping d ON userId = d.userShippingUserId AND d.userShippingPriorityFlag = 1
				LEFT OUTER JOIN UserPoint ON userPointUserId = userId
				LEFT OUTER JOIN (SELECT userPaymentHistoryCreatedAt, userPaymentHistoryUserId, ROW_NUMBER() OVER (PARTITION BY userPaymentHistoryUserId ORDER BY userPaymentHistoryCreatedAt DESC) AS latestId FROM UserPaymentHistory) 
					AS paymentView ON userId = userPaymentHistoryUserId AND latestId = 1
				LEFT OUTER JOIN User AS r ON r.userInvitationCode = User.userId
				LEFT OUTER JOIN Language ON languageId = User.userLanguageId
				${where}
				GROUP BY User.userId
				${having}
				${orderBy}
				LIMIT ?, ?`;

			parameter.push(Number(offset));
			parameter.push(Number(limit));

			console.log("final  sql_data ", sql_data);
			const [query_result_data] = await mysql_con.query(sql_data, parameter);
			console.log("kiiiiiii count ", query_result_count);

			response = {
				count: query_result_count[0]?.total_rows,
				records: query_result_data,
			};
		}
		//get detail
		else if (pathParameters !== null) {
			const { userId = 0 } = pathParameters || {};

			//For details data
			if (userId) {
				if (userId == "init") {
					const country_sql = `SELECT countryId, countryName FROM Country`;
					const [country_data] = await mysql_con.query(country_sql, []);

					response = {
						countries: country_data,
					};

					return getResponse(response, 200);
				}

				const {
					type,
					skip: offset = PAGES_VISITED,
					take: limit = ITEMS_PER_PAGE,
				} = queryStringParameters || {};

				parameter.push(Number(userId));

				if (!type) {
					const sql_data = `
						SELECT 
							User.userId,
							BIN_TO_UUID(User.userUUID) AS userUUID,
							User.userStatus,
							User.userDirectionId,
							User.userBillingFlag,
							User.userTestUserFlag,
							countryName,
							User.userEmail,
							User.userPassword,
							User.userBillingStopperFlag,
							User.userBirthday,
							User.userNickname,
							User.userName,
							User.userPalentalConsentFlag,
							userPointUsagePoint,
							userPointExchangePoint,
							userPointPurchasePoint,
							userPointPurchasePointStripeCredit,
							userPointPurchasePointStripeBank,
							userPointPurchasePointEpsilonCredit,
							userPointPurchasePointEpsilonBank,
							userPointPurchasePointEpsilonPaypay,
							userPointPurchasePointPaypay,
							userPointPurchasePointManualBank,
							userPointPurchaseValue,
							userPointPurchaseValueStripeCredit,
							userPointPurchaseValueStripeBank,
							userPointPurchaseValueEpsilonCredit,
							userPointPurchaseValueEpsilonBank,
							userPointPurchaseValueEpsilonPaypay,
							userPointPurchaseValuePaypay,
							userPointPurchaseValueManualBank,
							userPointCouponPoint,
							userPointPresentPoint,
							userPointSystemAdditionPoint,
							userPointSystemSubtractionPoint,
							userPointLostPoint,
							userPointCouponPoint,
							userPointShippingPoint,
							userPointShippingRefundPoint,
							userPointPurchaseCount,
							userPointLastPurchaseAt,
							userPointLastGachaAt,
							User.userCreatedAt,
							User.userUpdatedAt,
							User.userLastLoginAt,
							User.userLastActiveAt,
							User.userRegistIPAddress,
							User.userMemo,
							User.userSMSTelNo,
							User.userSMSFlag,
							User.userSMSTelLanguageCCValue,
							User.userInvitationCode,
							User.userLanguageId,
							Language.languageName,
							User.userAFCode,
							COUNT(r.userId) AS referralCount,
							(${sql_user_point_subquery}) AS userPointNowPoint,
							(${sql_user_collection_count}) AS userCollectionCount,
							(${sql_user_collection_convertable_point}) AS remainingConvertablePoint,
							User.userSMSAuthenticatedAt
						FROM User
						LEFT OUTER JOIN Country ON countryId = userCountryId
						LEFT OUTER JOIN UserPoint ON userPointUserId = User.userId
						LEFT OUTER JOIN Language ON languageId = User.userLanguageId
						LEFT OUTER JOIN User AS r ON r.userInvitationCode = User.userId
						WHERE User.userId = ?
						LIMIT 0, 1`;

					const [query_result_data] = await mysql_con.query(
						sql_data,
						parameter
					);

					if (query_result_data.length > 0) {
						response = { records: query_result_data[0] };
					} else {
						response = { message: "No records found" };
					}

					return getResponse(response, 200);
				}

				if (
					type == "collection" ||
					type == "shipping_await" ||
					type == "shipping_complete"
				) {
					let userCollectionStatus = 0;
					if (type == "collection") userCollectionStatus = 1;
					else if (type == "shipping_await") userCollectionStatus = 2;
					else if (type == "shipping_complete") userCollectionStatus = 3;

					let query_result_count = 0;
					let user_collection_query;

					if (type == "shipping_await") {
						// parameter.push(2);
						const sql_count = `
							SELECT 
								COUNT(userCollectionId) AS total_rows
							FROM UserCollection
							JOIN ItemTranslate on itemTranslateItemId = userCollectionItemId AND itemTranslateJpFlag = 1
							WHERE userCollectionUserId = ? AND (userCollectionStatus = 2 || userCollectionStatus = 5)
							`;
						[query_result_count] = await mysql_con.query(
							sql_count,
							parameter
						);

						user_collection_query = `
							SELECT 
								userCollectionId,
								itemTranslateName,
								userCollectionPoint,
								userCollectionCreatedAt*1000 AS userCollectionCreatedAt,
								userCollectionExpiredAt*1000 AS userCollectionExpiredAt,
								userCollectionRequestAt*1000 AS userCollectionRequestAt,
								userCollectionShippedAt*1000 AS userCollectionShippedAt
							FROM UserCollection
							JOIN ItemTranslate on itemTranslateItemId = userCollectionItemId AND itemTranslateJpFlag = 1
							WHERE userCollectionUserId = ? AND (userCollectionStatus = 2 || userCollectionStatus = 5)
							LIMIT ?, ?`;
					}
					else {
						parameter.push(userCollectionStatus);

						const sql_count = `
							SELECT 
								COUNT(userCollectionId) AS total_rows
							FROM UserCollection
							JOIN ItemTranslate on itemTranslateItemId = userCollectionItemId AND itemTranslateJpFlag = 1
							WHERE userCollectionUserId = ? AND userCollectionStatus = ?
							`;
						[query_result_count] = await mysql_con.query(
							sql_count,
							parameter
						);

						user_collection_query = `
							SELECT 
								userCollectionId,
								itemTranslateName,
								userCollectionPoint,
								userCollectionCreatedAt*1000 AS userCollectionCreatedAt,
								userCollectionExpiredAt*1000 AS userCollectionExpiredAt,
								userCollectionRequestAt*1000 AS userCollectionRequestAt,
								userCollectionShippedAt*1000 AS userCollectionShippedAt
							FROM UserCollection
							JOIN ItemTranslate on itemTranslateItemId = userCollectionItemId AND itemTranslateJpFlag = 1
							WHERE userCollectionUserId = ? AND userCollectionStatus = ?
							LIMIT ?, ?`;
					}
					parameter.push(Number(offset));
					parameter.push(Number(limit));
					const [query_result_data] = await mysql_con.query(
						user_collection_query,
						parameter
					);
					response = {
						count: query_result_count[0]?.total_rows,
						records: query_result_data,
					};
					return getResponse(response, 200);
				}

				if (type == "present") {
					const sql_count = `
						SELECT 
							COUNT(userPresentId) AS total_rows
						FROM UserPresent
						JOIN Present ON userPresentPresentId = presentId
						WHERE userPresentUserId = ?`;

					const [query_result_count] = await mysql_con.query(
						sql_count,
						parameter
					);

					const user_collection_query = `
						SELECT 
							userPresentId,
							presentName,
							presentPoint,
							userPresentCreatedAt*1000 AS userPresentCreatedAt,
							userPresentExpiredAt*1000 AS userPresentExpiredAt,
							userPresentUsedAt*1000 AS userPresentUsedAt
						FROM UserPresent
						JOIN Present ON userPresentPresentId = presentId
						WHERE userPresentUserId = ?
						LIMIT ?, ?`;

					parameter.push(Number(offset));
					parameter.push(Number(limit));

					const [query_result_data] = await mysql_con.query(
						user_collection_query,
						parameter
					);

					response = {
						count: query_result_count[0]?.total_rows,
						records: query_result_data,
					};

					return getResponse(response, 200);
				}
				//stripe
				if (type == "payment_history") {
					const sql_count = `
						SELECT 
						COUNT(userPaymentHistoryId) AS total_rows
						FROM UserPaymentHistory
						WHERE userPaymentHistoryUserId = ? AND userPaymentHistoryPaymentPattern = ?`;
					
					parameter.push(1);
					const [query_result_count] = await mysql_con.query(
						sql_count,
						parameter
					);

					const user_collection_query = `
						SELECT
							userPaymentHistoryId,
							userPaymentHistoryPaymentIntent,
							userPaymentHistoryPaymentPoint,
							userPaymentHistoryStatus,
							userPaymentHistoryAFCode,
							userPaymentHistoryInvitationCode,
							userPaymentHistoryCreatedAt*1000 AS userPaymentHistoryCreatedAt,
							userPaymentHistoryCardFingerPrint,
							userPaymentHistoryIPAddress1,
							userId,
							userEmail,
							userSMSTelNo
						FROM UserPaymentHistory
						JOIN User ON userId = userPaymentHistoryUserId
						WHERE userPaymentHistoryUserId = ? AND userPaymentHistoryPaymentPattern = ?
						ORDER BY userPaymentHistoryCreatedAt DESC
						LIMIT ?, ?`;

					parameter.push(Number(offset));
					parameter.push(Number(limit));

					const [query_result_data] = await mysql_con.query(
						user_collection_query,
						parameter
					);

					response = {
						count: query_result_count[0]?.total_rows,
						records: query_result_data,
					};

					return getResponse(response, 200);
				}
				//epsilon credit card
				if (type == "payment_history_epsilon") {
					const sql_count = `
						SELECT 
						COUNT(userPaymentHistoryId) AS total_rows
						FROM UserPaymentHistory
						WHERE userPaymentHistoryUserId = ? AND userPaymentHistoryPaymentPattern = ?`;

						parameter.push(3);
					const [query_result_count] = await mysql_con.query(
						sql_count,
						parameter
					);

					const user_collection_query = `
						SELECT
						userPaymentHistoryId,
						userPaymentHistoryPaymentPoint,
						userPaymentHistoryStatus,
						userPaymentHistoryCardNo,
						userPaymentHistoryCardExpired,
						userPaymentHistoryCardCVC,
						userPaymentHistoryCardHolderName,
						userPaymentHistoryIPAddress1,
						userPaymentHistoryIPAddress2,
						userPaymentHistoryIPAddress3,
						userPaymentHistoryCreatedAt*1000 AS userPaymentHistoryCreatedAt,
						userPaymentHistoryPaymentStartedAt*1000 AS userPaymentHistoryPaymentStartedAt,
						userPaymentHistory3DSecureStartedAt*1000 AS userPaymentHistory3DSecureStartedAt,
						userPaymentHistoryPaymentFinishedAt*1000 AS userPaymentHistoryPaymentFinishedAt
						FROM UserPaymentHistory
						WHERE userPaymentHistoryUserId = ? AND userPaymentHistoryPaymentPattern = ?
						ORDER BY userPaymentHistoryCreatedAt DESC
						LIMIT ?, ?`;

					parameter.push(Number(offset));
					parameter.push(Number(limit));

					const [query_result_data] = await mysql_con.query(
						user_collection_query,
						parameter
					);

					response = {
						count: query_result_count[0]?.total_rows,
						records: query_result_data,
					};

					return getResponse(response, 200);
				}
				//bankTransfer
				if (type == "payment_history_banktransfer") {
					const sql_count = `
						SELECT 
						COUNT(userPaymentHistoryId) AS total_rows
						FROM UserPaymentHistory
						WHERE userPaymentHistoryUserId = ? AND userPaymentHistoryPaymentPattern = ?`;
						parameter.push(7);
					const [query_result_count] = await mysql_con.query(
						sql_count,
						parameter
					);

					const user_collection_query = `
						SELECT
						userPaymentHistoryId,
						userPaymentHistoryPaymentPoint,
						SUM(pointHistoryPoint) AS pointHistoryPoint,
						SUM(pointHistoryPaymentValue) AS pointHistoryPaymentValue,
						userPaymentHistoryPayerMail,
						userPaymentHistoryPayerTelNo,
						userPaymentHistoryPayerName,
						userPaymentHistoryIPAddress1,
						userPaymentHistoryPaymentFinishedAt*1000 AS userPaymentHistoryPaymentFinishedAt,
						userPaymentHistoryCreatedAt*1000 AS userPaymentHistoryCreatedAt
						FROM UserPaymentHistory
						LEFT OUTER JOIN PointHistory ON PointHistory.pointHistoryUserPaymentHistoryId = UserPaymentHistory.userPaymentHistoryId
						WHERE userPaymentHistoryUserId = ? AND userPaymentHistoryPaymentPattern = ?
						ORDER BY userPaymentHistoryCreatedAt DESC
						LIMIT ?, ?`;

					parameter.push(Number(offset));
					parameter.push(Number(limit));

					const [query_result_data] = await mysql_con.query(
						user_collection_query,
						parameter
					);

					response = {
						count: query_result_count[0]?.total_rows,
						records: query_result_data,
					};

					return getResponse(response, 200);
				}

				if (type == "coupon") {
					const sql_count = `
						SELECT 
						COUNT(userCouponId) AS total_rows
						FROM 
						UserCoupon
						JOIN
						Coupon ON couponId = userCouponCouponId
						WHERE 
						userCouponUserId = ?`;

					const [query_result_count] = await mysql_con.query(
						sql_count,
						parameter
					);

					const user_collection_query = `
						SELECT 
						userCouponId,
						couponName,
						couponCode,
						couponPoint,
						userCouponCreatedAt*1000 AS userCouponCreatedAt
						FROM 
						UserCoupon
						JOIN 
						Coupon ON couponId = userCouponCouponId
						WHERE 
						userCouponUserId = ?
						ORDER BY 
						userCouponCreatedAt DESC
						LIMIT 
						?, ?`;

					parameter.push(Number(offset));
					parameter.push(Number(limit));

					const [query_result_data] = await mysql_con.query(
						user_collection_query,
						parameter
					);

					response = {
						count: query_result_count[0]?.total_rows,
						records: query_result_data,
					};

					return getResponse(response, 200);
				}

				if (type == "user_friends") {
					const sql_count = `SELECT COUNT(userId) AS total_rows FROM  User WHERE userInvitationCode = ?`;

					const [query_result_count] = await mysql_con.query(
						sql_count,
						parameter
					);

					const user_collection_query = `
						SELECT 
						userId as userFriendUserId,
						userEmail,
						userCreatedAt*1000 AS userCreatedAt,
						userSMSAuthenticatedAt*1000 AS userSMSAuthenticatedAt
						FROM User WHERE 
						userInvitationCode = ?
						ORDER BY 
						userCreatedAt DESC
						LIMIT 
						?, ?`;

					parameter.push(Number(offset));
					parameter.push(Number(limit));

					const [query_result_data] = await mysql_con.query(
						user_collection_query,
						parameter
					);

					response = {
						count: query_result_count[0]?.total_rows,
						records: query_result_data,
					};

					return getResponse(response, 200);
				}

				if (type == 'shipping_address') {
					const sql_count = `SELECT COUNT(userShippingId) AS total_rows FROM  UserShipping WHERE userShippingUserId = ?`;

					const [query_result_count] = await mysql_con.query(sql_count, parameter);

					const user_collection_query = `
						SELECT 
							userShippingId,
							userShippingName,
							userShippingZipcode,
							userShippingAddress,
							userShippingAddress2,
							userShippingAddress3,
							userShippingAddress4,
							userShippingTelCountryCode,
							userShippingTel,
							CASE WHEN userShippingPriorityFlag = 1 THEN '○' ELSE '' END AS userShippingPriorityFlag
						FROM UserShipping
						WHERE userShippingUserId = ?
						ORDER BY userShippingCreatedAt DESC
						LIMIT ?, ?`;

					parameter.push(Number(offset));
					parameter.push(Number(limit));

					const [query_result_data] = await mysql_con.query(user_collection_query, parameter);

					response = {
						count: query_result_count[0]?.total_rows,
						records: query_result_data,
					};

					return getResponse(response, 200);
				}

				//userSMS
				if (type == 'user_sms') {
					const sql_count = `SELECT COUNT(userSmsHistoryId) AS total_rows FROM UserSmsHistory WHERE userSmsHistoryUserId = ?`;

					const [query_result_count] = await mysql_con.query(sql_count, parameter);

					const user_collection_query = `
						SELECT 
							userSmsHistoryId,
							userSmsHistoryTellNo,
							userSmsHistoryTellCountryCode,
							userSmsHistoryOtp,
							userSmsHistoryCreatedAt*1000 AS userSmsHistoryCreatedAt,
							userSmsHistoryExpiredAt*1000 AS userSmsHistoryExpiredAt,
							userSmsHistoryType,
							CASE WHEN userSmsHistoryStatus = 1 THEN '成功' ELSE '認証失敗' END AS userSmsHistoryStatus
						FROM UserSmsHistory
						WHERE userSmsHistoryUserId = ?
						ORDER BY userSmsHistoryCreatedAt DESC
						LIMIT ?, ?`;

					parameter.push(Number(offset));
					parameter.push(Number(limit));

					const [query_result_data] = await mysql_con.query(user_collection_query, parameter);

					response = {
						count: query_result_count[0]?.total_rows,
						records: query_result_data,
					};

					return getResponse(response, 200);
				}
			}
		}
		console.log("my response", response);
		return getResponse(response, 200);
	} catch (error) {
		console.error("error:", error);
		return getResponse(error, 400);
	} finally {
		if (mysql_con) await mysql_con.close();
	}

	function getResponse(data, statusCode = 200) {
		return {
			statusCode,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Headers": "*",
			},
			body: JSON.stringify(data),
		};
	}
};
