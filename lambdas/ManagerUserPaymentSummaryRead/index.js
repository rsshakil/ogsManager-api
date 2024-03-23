/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const commonFunctions = require('./commonFunctions/getWhereFromFilter');
const commonFunctions1 = require('./commonFunctions/convertToMySQLSort');
const ssm = new AWS.SSM();
process.env.TZ = "Asia/Tokyo";
const PAGES_VISITED = 0;
const ITEMS_PER_PAGE = 500;

const mapperKey = {
    userStatus: "User.userStatus",
    userDirectionId: "User.userDirectionId",
    countryName: "User.userCountryId",
    userPaymentHistoryStatusCaption: "userPaymentHistoryStatus",
    languageName: "Language.languageName",
    userId: "User.userId",
    userEmail: "User.userEmail",
    userSMSFlag: "User.userSMSFlag",
    userBillingFlag: "User.userBillingFlag",
    userUUID: "User.userUUID",
    userInvitationCode: "User.userInvitationCode",
    userSMSTelNo: "User.userSMSTelNo",
    userCreatedAt: "User.userCreatedAt",
    userLastActiveAt: "User.userLastActiveAt",
    userLastLoginAt: "User.userLastLoginAt",
    userRegistIPAddress: "User.userRegistIPAddress",
    userAFCode: "User.userAFCode",
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
            Name: 'PS_' + process.env.ENV,
            WithDecryption: true
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
        charset: process.env.DBCHARSET
    };

    let parameter = [];
    let mysql_con;
    let response;

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(readDbConfig);
        const { queryStringParameters = null, pathParameters = null } = event || {};
        let nowTimeStamp = Math.floor(new Date().getTime());
        const today = new Date();
        // adjust when day is sunday
        let dayCalc = today.getDay() || 7;
        const todayStart = Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime()/1000)
        const todayEnd = Math.floor(new Date(new Date().setHours(23, 59, 59, 999)).getTime()/1000)

        const yesterdayStart = Math.floor(new Date(new Date(new Date().setHours(0, 0, 0, 0)).setDate(new Date().getDate() - 1)).getTime()/1000)
        const yesterdayEnd = Math.floor(new Date(new Date(new Date().setHours(23, 59, 59, 999)).setDate(new Date().getDate() - 1)).getTime()/1000)

        const yesterdayBeforeStart = Math.floor(new Date(new Date(new Date().setHours(0, 0, 0, 0)).setDate(new Date().getDate() - 2)).getTime()/1000)
        const yesterdayBeforeEnd = Math.floor(new Date(new Date(new Date().setHours(23, 59, 59, 999)).setDate(new Date().getDate() - 2)).getTime()/1000)

        
        const firstDayOfWeek = Math.floor(new Date(new Date(new Date().setHours(0, 0, 0, 0)).setDate(new Date().getDate() - dayCalc+1)).getTime()/1000)
        const lastDayOfWeek = Math.floor(new Date(new Date(new Date().setHours(23, 59, 59, 999)).setDate(new Date().getDate()- dayCalc + 7)).getTime()/1000)
        
        const firstDayOfLastWeek = Math.floor(new Date(new Date(new Date().setHours(0, 0, 0, 0)).setDate(new Date().getDate() - dayCalc-6)).getTime()/1000)
        const lastDayOfLastWeek = Math.floor(new Date(new Date(new Date().setHours(23, 59, 59, 999)).setDate(new Date().getDate() - dayCalc)).getTime()/1000)

        const monthStart = Math.floor(new Date(new Date(new Date().getFullYear(), new Date().getMonth(), 1).setHours(0, 0, 0, 0)).getTime()/1000)
        const monthEnd = Math.floor(new Date(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).setHours(23, 59, 59, 999)).getTime()/1000)

        const previousMonthStart = Math.floor(new Date(new Date(new Date().getFullYear(), new Date().getMonth() -1).setHours(0, 0, 0, 0)).getTime()/1000)
        const previousMonthEnd = Math.floor(new Date(new Date(new Date().getFullYear(), new Date().getMonth(), 0).setHours(23, 59, 59, 999)).getTime()/1000)

/*
        const sql_data = `
        SELECT DISTINCT
            (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1) AS summaryTotal,
            (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 1) AS stripeCreditTotal,
            (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 2) AS stripeBankTotal,
            (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 3) AS epsilonCreditTotal,
            (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 4) AS epsilonBankTotal,
            (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 5) AS epsilonPayPayTotal,
            (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 6) AS paypayDirectTotal,
            (
            	SELECT 
            		SUM(pointHistoryPaymentValue)
            	FROM PointHistory 
            	INNER JOIN 
            	(SELECT userPaymentHistoryId FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 7) AS PaymentData
            	ON PointHistory.pointHistoryUserPaymentHistoryId = PaymentData.userPaymentHistoryId
            ) AS directBankTransferTotal
        FROM UserPaymentHistory`;
*/
        const sql_data = `SELECT
            (IFNULL(stripeCreditTotal, 0) + IFNULL(stripeBankTotal, 0) + IFNULL(epsilonCreditTotal, 0) + IFNULL(epsilonBankTotal, 0) + IFNULL(epsilonPayPayTotal, 0) + IFNULL(paypayDirectTotal, 0) + IFNULL(directBankTransferTotal, 0)) AS summaryTotal,
            stripeCreditTotal,
            stripeBankTotal,
            epsilonCreditTotal,
            epsilonBankTotal,
            epsilonPayPayTotal,
            paypayDirectTotal,
            directBankTransferTotal
        FROM (
        SELECT DISTINCT
                    (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 1) AS stripeCreditTotal,
                    (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 2) AS stripeBankTotal,
                    (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 3) AS epsilonCreditTotal,
                    (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 4) AS epsilonBankTotal,
                    (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 5) AS epsilonPayPayTotal,
                    (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 6) AS paypayDirectTotal,
                    (
                        SELECT 
                            SUM(pointHistoryPaymentValue)
                        FROM PointHistory 
                        INNER JOIN 
                        (SELECT userPaymentHistoryId FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 7) AS PaymentData
                        ON PointHistory.pointHistoryUserPaymentHistoryId = PaymentData.userPaymentHistoryId
                    ) AS directBankTransferTotal
                FROM UserPaymentHistory
        ) AS o`;

        const sql_data2 = `SELECT
            (IFNULL(stripeCreditTotal, 0) + IFNULL(stripeBankTotal, 0) + IFNULL(epsilonCreditTotal, 0) + IFNULL(epsilonBankTotal, 0) + IFNULL(epsilonPayPayTotal, 0) + IFNULL(paypayDirectTotal, 0) + IFNULL(directBankTransferTotal, 0)) AS summaryTotal,
            stripeCreditTotal,
            stripeBankTotal,
            epsilonCreditTotal,
            epsilonBankTotal,
            epsilonPayPayTotal,
            paypayDirectTotal,
            directBankTransferTotal
        FROM (
            SELECT DISTINCT
                (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 1 AND userPaymentHistoryCreatedAt BETWEEN ? AND ?) AS stripeCreditTotal,
                (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 2 AND userPaymentHistoryCreatedAt BETWEEN ? AND ?) AS stripeBankTotal,
                (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 3 AND userPaymentHistoryCreatedAt BETWEEN ? AND ?) AS epsilonCreditTotal,
                (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 4 AND userPaymentHistoryCreatedAt BETWEEN ? AND ?) AS epsilonBankTotal,
                (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 5 AND userPaymentHistoryCreatedAt BETWEEN ? AND ?) AS epsilonPayPayTotal,
                (SELECT SUM(userPaymentHistoryPaymentPoint) AS summaryEpsilonCredit FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 6 AND userPaymentHistoryCreatedAt BETWEEN ? AND ?) AS paypayDirectTotal,
                (
                    SELECT 
                        SUM(pointHistoryPaymentValue)
                    FROM PointHistory 
                    INNER JOIN 
                    (SELECT userPaymentHistoryId FROM UserPaymentHistory WHERE userPaymentHistoryStatus = 1 AND userPaymentHistoryPaymentPattern = 7) AS PaymentData
                    ON PointHistory.pointHistoryUserPaymentHistoryId = PaymentData.userPaymentHistoryId
                    WHERE pointHistoryPointAt BETWEEN ? AND ?
                ) AS directBankTransferTotal
            FROM UserPaymentHistory
        ) AS o`;

        const [query_result_data1] = await mysql_con.query(sql_data, []);

        console.log({
            todayStart,
            todayEnd,
            yesterdayStart,
            yesterdayEnd,
            yesterdayBeforeStart,
            yesterdayBeforeEnd,
            monthStart,
            monthEnd,
            previousMonthStart,
            previousMonthEnd,
            firstDayOfWeek,
            lastDayOfWeek,
            firstDayOfLastWeek,
            lastDayOfLastWeek,
        })
        
        const dateArray = {
            2:[todayStart,todayEnd,todayStart,todayEnd], // 今日
            3:[yesterdayStart,yesterdayEnd,yesterdayStart,yesterdayEnd], // 昨日
            4:[yesterdayBeforeStart,yesterdayBeforeEnd,yesterdayBeforeStart,yesterdayBeforeEnd], // 一昨日
            5:[firstDayOfWeek,lastDayOfWeek,firstDayOfWeek,lastDayOfWeek], // 今週
            6:[firstDayOfLastWeek,lastDayOfLastWeek,firstDayOfLastWeek,lastDayOfLastWeek], // 先週
            7:[monthStart,monthEnd,monthStart,monthEnd], // 今月
            8:[previousMonthStart,previousMonthEnd,previousMonthStart,previousMonthEnd] // 先月
        }
        
        console.log("query_result_data1", query_result_data1);
        const unixTimestampToDateFormat = (unixTimestamp, time = true, jpFormat = false, showDayName = false) => {
                // Create a Date object from the Unix timestamp
                const date = new Date(unixTimestamp * 1000); // Unix timestamp is in seconds, so multiply by 1000 to convert to milliseconds
        
                // Extract year, month, day, hour, and minute
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0'); // Month is 0-based, so add 1 and pad with leading zero
                const day = String(date.getDate()).padStart(2, '0');
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
        
                // Format the date as "yyyy/MM/dd HH:mm"
                // let value = `${year}/${month}/${day}`;
                let dayName = date.toLocaleDateString("ja-JP", { weekday: 'short' });

                let value = `${year}${jpFormat?"年":"/"}${month}${jpFormat?"月":"/"}${day}${jpFormat?"日 ":" "}`;
                if (time) {
                    value += `${hours}:${minutes}`;
                }
                if (showDayName) {
                    value += ` （${dayName}）`;
                }
                return value;
        }

        const getSummaryInfoDetails = async (resultType) => {
            if(resultType == 1){
                return {
                    totalType:resultType,
                    dateFromTo:"すべて",
                    summaryTotal:query_result_data1[0].summaryTotal??0,
                    summaryEpsilonCredit:query_result_data1[0].epsilonCreditTotal??0,
                    summaryStripeCredit:query_result_data1[0].stripeCreditTotal??0,
                    summaryBankTransferManual:query_result_data1[0].directBankTransferTotal
                }
            }
            else{
                let paramArray = [...dateArray[resultType],...dateArray[resultType],...dateArray[resultType],...dateArray[resultType]];
                console.log("paramArray",paramArray);
                let dateFromTo = `${unixTimestampToDateFormat(paramArray[0],true,true,true)} ~   ${unixTimestampToDateFormat(paramArray[1],true,true,true)}`;
                const [results] = await mysql_con.query(sql_data2, [...paramArray]);
                
                return {
                    totalType:resultType,
                    dateFromTo:dateFromTo,
                    summaryTotal:results[0].summaryTotal??0,
                    summaryEpsilonCredit:results[0].epsilonCreditTotal??0,
                    summaryStripeCredit:results[0].stripeCreditTotal??0,
                    summaryBankTransferManual:results[0].directBankTransferTotal??0
                }
            }
        }
        
        let summaryInfo = [];
        //全て not require for that it started from 2 
        // 2 = 
        for(let i = 2; i <= 8; i++){
            let getSummaryInfo = await getSummaryInfoDetails(i);
            summaryInfo.push(getSummaryInfo)
        }

        response = { 
            records: summaryInfo,
         }

        console.log('my response', response)
        return getResponse(response, 200);

    } catch (error) {
        console.error("error:", error)
        return getResponse(error, 400);
    } finally {
        if (mysql_con) await mysql_con.close();
    }
    
    function getResponse(data, statusCode = 200) {
        return {
            statusCode,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(data),
        }
    }
};