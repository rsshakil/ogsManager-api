/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const redis = require("ioredis");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const commonFunctions = require('./commonFunctions/getWhereFromFilter');
const commonFunctions1 = require('./commonFunctions/convertToMySQLSort');


const mapperKey = {
    userId: "User.userId",
    countryName: "User.userCountryId",
    userStatus: "User.userStatus",
    userSMSTelNo: "User.userSMSTelNo",
    userSMSFlag: "User.userSMSFlag",
    userCountryId: "User.userCountryId",
    userEmail: "User.userEmail",
    userDirectionId: "User.userDirectionId",
    userSMSTelNoFormat: "User.userSMSTelNoFormat",
    userSMSTelLanguageCCValue: "User.userSMSTelLanguageCCValue",
    userRegistIPAddress: "User.userRegistIPAddress",
    userCreatedAt: "User.userCreatedAt",
    userLastActiveAt: "User.userLastActiveAt",
    userLastLoginAt: "User.userLastLoginAt",
    userInvitationCode: "User.userInvitationCode",
    itemTags: "itemTagTagId",
}
const havingKeys = [
    "userCollectionCount",
    "remainingConvertablePoint",
    "userPointNowPoint",
    "referralCount",
    "userShippingNameCount",
    "userShippingAddressCount",
    "userCollectionShippingAddress23",
    "userShippingAddress23Count",
    "userShippingTelCount",
    "userRegistIPCount",
    "referralCount",
];

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
        process.env.REDISPOINT1 = dbinfo.REDISPOINT1;
        process.env.REDISPOINT2 = dbinfo.REDISPOINT2;
        process.env.ENVID = dbinfo.ENVID;
    }

    // Database info
    const readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    const ENVID = process.env.ENVID;

    const redisConfig = [
        { host: process.env.REDISPOINT1, port: 6379 },
        { host: process.env.REDISPOINT2, port: 6379 }
    ];
    // ユーザー情報をRedisに書き出す

    const cluster = new redis.Cluster(
        redisConfig,
        {
            dnsLookup: (address, callback) => callback(null, address),
            redisOptions: { tls: true }
        }
    );

    let parameter = [];
    let mysql_con;
    const TEMP_FILE_NAME = 'output.csv';

    const { queryStringParameters = null } = event || {};
    const { filter, sort } = queryStringParameters || {};

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(readDbConfig);

        let where = '';
        let having = '';

        if (filter) {
            const { condition = '', conditionParameters = [], havingCondition = '', havingConditionParameters = [] } = commonFunctions.getWhereFromFilter(filter, mapperKey, havingKeys);
            if (condition) {
                where = condition;
                parameter = [...parameter, ...conditionParameters];
            }

            if (where) where += ` AND userCollectionStatus > ?`;
            else where += ` WHERE userCollectionStatus > ?`;

            parameter.push(1);

            if (havingCondition) {
                having = havingCondition;
                parameter = [...parameter, ...havingConditionParameters];
            }
        }
        else {
            where += ` WHERE userCollectionStatus > ?`;
            parameter.push(1);
        }

        console.log('my where is ', where);
        console.log('my where parameter is ', parameter);

        let orderBy = commonFunctions1.convertToMySQLSort(sort, 'userCollectionRequestAt DESC');

        //Sub queries
        const sql_user_point_subquery = `SELECT COALESCE(SUM(pointWalletPoint), 0) AS userPointNowPoint FROM PointWallet WHERE pointWalletUserId = User.userId`;
        const sql_user_collection_count = `SELECT COUNT(userCollectionId) AS userCollectionCount FROM UserCollection WHERE userCollectionUserId = User.userId AND userCollectionStatus = 1`;
        const sql_user_collection_convertable_point = `SELECT COALESCE(SUM(userCollectionPoint), 0) AS remainingConvertablePoint FROM UserCollection WHERE userCollectionUserId = User.userId AND userCollectionStatus = 1`;

        let selectColumns = [
            'userCollectionId',
            'userCollectionShippingName',
            'userCollectionShippingZipcode',
            'userCollectionShippingAddress',
            'userCollectionShippingAddress2',
            'userCollectionShippingAddress3',
            'userCollectionShippingAddress4',
            'userCollectionShippingTel',
        ]

        if (findFilterItem(['userPointNowPoint'])) selectColumns.push(`(${sql_user_point_subquery}) AS userPointNowPoint`);
        if (findFilterItem(['userCollectionCount'])) selectColumns.push(`(${sql_user_collection_count}) AS userCollectionCount`);
        if (findFilterItem(['remainingConvertablePoint'])) selectColumns.push(`(${sql_user_collection_convertable_point}) AS remainingConvertablePoint`);

        const userFilterKeys = [
            'userDirectionId',
            'userId',
            'userEmail',
            'userRegistIPAddress',
            'userSMSTelLanguageCCValue',
            'userSMSTelNoFormat',
            'userStatus',
            'userSMSFlag',
            'userSMSTelNo',
            'userCreatedAt',
            'userLastActiveAt',
            'userLastLoginAt',
            'userBillingFlag',
            'userUUID',
            'userAFCode',
            'userInvitationCode',
            'userSMSAuthenticatedAt'
        ];

        const itemFilterKeys = ['itemTranslateName', 'itemAttribute3'];
        const itemTagsFilterKeys = ['itemTags'];
        const countryFilterKeys = ['countryName'];
        const languageFilterKeys = ['languageName'];
        const pointFilterKeys = [
            'userPointUsagePoint',
            'userPointExchangePoint',
            'userPointPurchasePoint',
            'userPointCouponPoint',
            'userPointPresentPoint',
            'userPointSystemAdditionPoint',
            'userPointSystemSubtractionPoint',
            'userPointLostPoint',
            'userPointShippingPoint',
            'userPointShippingRefundPoint',
            'userPointPurchaseCount',
            'userPointLastGachaAt',
            'userPointLastPurchaseAt'
        ];

        let join = ``;

        if (findFilterItem([...userFilterKeys, ...countryFilterKeys, ...languageFilterKeys, ...pointFilterKeys, 'userRegistIPCount', 'referralCount'])) {
            join += ` JOIN User ON UserCollection.userCollectionUserId = User.userId `;
        }

        if (findFilterItem(itemFilterKeys)) {
            join += ` 
            JOIN Item ON UserCollection.userCollectionItemId = Item.itemId
            JOIN ItemTranslate ON Item.itemId = ItemTranslate.itemTranslateItemId AND itemTranslateJpFlag = 1 `;
        }

        if (findFilterItem(itemTagsFilterKeys)) {
            join += ` LEFT OUTER JOIN ItemTag ON userCollectionItemId = itemTagItemId `;
        }

        if (findFilterItem(countryFilterKeys)) {
            join += ` JOIN Country ON countryId = userCountryId `;
        }

        if (findFilterItem(languageFilterKeys)) {
            join += ` LEFT OUTER JOIN Language ON languageId = User.userLanguageId `;
        }

        if (findFilterItem(pointFilterKeys)) {
            join += ` LEFT OUTER JOIN UserPoint ON userPointUserId = User.userId `;
        }

        if (findFilterItem(['referralCount'])) {
            join += ` LEFT OUTER JOIN (SELECT userInvitationCode, COUNT(*) AS referralCount FROM User GROUP BY userInvitationCode ) AS r ON r.userInvitationCode = User.userId `;
            selectColumns.push('referralCount');
        }

        if (findFilterItem(['userRegistIPCount'])) {
            join += ` LEFT OUTER JOIN (SELECT userRegistIPAddress, COUNT(*) AS userRegistIPCount FROM User GROUP BY userRegistIPAddress) AS a ON User.userRegistIPAddress = a.userRegistIPAddress `;
            selectColumns.push('userRegistIPCount');
        }

        if (findFilterItem(['userShippingTelCount'])) {
            join += ` LEFT OUTER JOIN (SELECT userShippingTelCountryCode, userShippingTel, COUNT(*) AS userShippingTelCount FROM UserShipping GROUP BY userShippingTelCountryCode, userShippingTel) AS b ON userCollectionShippingTel = b.userShippingTel AND userCollectionShippingTelCountryCode = b.userShippingTelCountryCode `;
            selectColumns.push('userShippingTelCount');
        }

        if (findFilterItem(['userShippingAddress23Count'])) {
            join += ` LEFT OUTER JOIN (SELECT userShippingAddress2, userShippingAddress3, COUNT(*) AS userShippingAddress23Count FROM UserShipping GROUP BY userShippingAddress2, userShippingAddress3) AS c ON userCollectionShippingAddress2 = c.userShippingAddress2 AND userCollectionShippingAddress3 = c.userShippingAddress3 `;
            selectColumns.push('userShippingAddress23Count');
        }

        if (findFilterItem(['userShippingAddressCount'])) {
            join += ` LEFT OUTER JOIN (SELECT userShippingAddress, COUNT(*) AS userShippingAddressCount FROM UserShipping GROUP BY userShippingAddress) AS d ON userCollectionShippingAddress = d.userShippingAddress `;
            selectColumns.push('userShippingAddressCount');
        }

        if (findFilterItem(['userShippingNameCount'])) {
            join += ` LEFT OUTER JOIN (SELECT userShippingName, COUNT(*) AS userShippingNameCount FROM UserShipping GROUP BY userShippingName) AS e ON userCollectionShippingName = e.userShippingName `;
            selectColumns.push('userShippingNameCount');
        }

        //Generate final sql
        const sql_data = `SELECT ${selectColumns.join(', ')} FROM UserCollection ${join} ${where} GROUP BY userCollectionId ${having} ${orderBy}`;

        console.log('sql_data >>>>', sql_data)

        const [query_result_data] = await mysql_con.query(sql_data, parameter);

        //Get redis data
        const systemYuPriName = await cluster.get("system:" + ENVID + ":ypn");
        const systemYuPriZipCode = await cluster.get("system:" + ENVID + ":ypzc");
        const systemYuPriPrefecture = await cluster.get("system:" + ENVID + ":ypp");
        const systemYuPriAddress1 = await cluster.get("system:" + ENVID + ":ypa1");
        const systemYuPriAddress2 = await cluster.get("system:" + ENVID + ":ypa2");
        const systemYuPriAddress3 = await cluster.get("system:" + ENVID + ":ypa3");
        const systemYuPriTelNo = await cluster.get("system:" + ENVID + ":yptn");
        const systemYuPriCompanyName = await cluster.get("system:" + ENVID + ":ypcn");
        const systemYuPriEmailAddress = await cluster.get("system:" + ENVID + ":ypea");

        const headers = [
            { id: 'product', title: '商品' },
            { id: 'cod', title: '着払/代引' },
            { id: 'golfSkiAirport', title: 'ゴルフ/スキー/空港' },
            { id: 'roundTrip', title: '往復' },
            { id: 'mailRecord', title: '書留/特定記録' },
            { id: 'deliveryMethod', title: '配達方法' },
            { id: 'createCount', title: '作成数' },
            { id: 'userCollectionShippingName', title: 'お届け先のお名前' },
            { id: 'recipientsTitle', title: 'お届け先の敬称' },
            { id: 'recipientsNameKana', title: 'お届け先のお名前（カナ）' },
            { id: 'userCollectionShippingZipcode', title: 'お届け先の郵便番号' },
            { id: 'userCollectionShippingAddress', title: 'お届け先の都道府県' },
            { id: 'userCollectionShippingAddress2', title: 'お届け先の市区町村郡' },
            { id: 'userCollectionShippingAddress3', title: 'お届け先の丁目番地号' },
            { id: 'userCollectionShippingAddress4', title: 'お届け先の建物名・部屋番号など' },
            { id: 'userCollectionShippingTel', title: 'お届け先の電話番号' },
            { id: 'recipientsCompanyName', title: 'お届け先の法人名' },
            { id: 'recipientsDepartmentName', title: 'お届け先の部署名' },
            { id: 'recipientsEmail', title: 'お届け先のメールアドレス' },
            { id: 'airportAbbreviation', title: '空港略称' },
            { id: 'airportCode', title: '空港コード' },
            { id: 'recipientsName', title: '受取人様のお名前' },
            { id: 'systemYuPriName', title: 'ご依頼主のお名前' },
            { id: 'senderTitle', title: 'ご依頼主の敬称' },
            { id: 'semderNameKana', title: 'ご依頼主のお名前（カナ）' },
            { id: 'systemYuPriZipCode', title: 'ご依頼主の郵便番号' },
            { id: 'systemYuPriPrefecture', title: 'ご依頼主の都道府県' },
            { id: 'systemYuPriAddress1', title: 'ご依頼主の市区町村郡' },
            { id: 'systemYuPriAddress2', title: 'ご依頼主の丁目番地号' },
            { id: 'systemYuPriAddress3', title: 'ご依頼主の建物名・部屋番号など' },
            { id: 'systemYuPriTelNo', title: 'ご依頼主の電話番号' },
            { id: 'systemYuPriCompanyName', title: 'ご依頼主の法人名' },
            { id: 'senderDepartmentName', title: 'ご依頼主の部署名' },
            { id: 'systemYuPriEmailAddress', title: 'ご依頼主のメールアドレス' },
            { id: 'itemName', title: '品名' },
            { id: 'itemId', title: '品名番号' },
            { id: 'qty', title: '個数' },
            { id: 'shippingDate', title: '発送予定日' },
            { id: 'shippingTime', title: '発送予定時間帯' },
            { id: 'security', title: 'セキュリティ' },
            { id: 'weight', title: '重量' },
            { id: 'damageAmount', title: '損害要償額' },
            { id: 'coldStorage', title: '保冷' },
            { id: 'precaution1', title: '取扱上の注意　こわれもの' },
            { id: 'precaution2', title: '取扱上の注意　なまもの' },
            { id: 'precaution3', title: '取扱上の注意　ビン類' },
            { id: 'precaution4', title: '取扱上の注意　逆さま厳禁' },
            { id: 'precaution5', title: '取扱上の注意　下積み厳禁' },
            { id: 'spare', title: '予備' },
            { id: 'deliveryDate', title: '差出予定日' },
            { id: 'deliveryTime', title: '差出予定時間帯' },
            { id: 'receiveDate', title: '配達希望日' },
            { id: 'receiveTime', title: '配達希望時間帯' },
            { id: 'clubCount', title: 'クラブ本数' },
            { id: 'usageDate', title: 'ご使用日(プレー日)' },
            { id: 'usageTime', title: 'ご使用時間' },
            { id: 'flightDate', title: '搭乗日' },
            { id: 'bordingTime', title: '搭乗時間' },
            { id: 'flightNo', title: '搭乗便名' },
            { id: 'returnDate', title: '復路発送予定日' },
            { id: 'paymentMethod', title: 'お支払方法' },
            { id: 'remarks', title: '摘要/記事' },
            { id: 'size', title: 'サイズ' },
            { id: 'sendingMethod', title: '差出方法' },
            { id: 'discount', title: '割引' },
            { id: 'codAmount', title: '代金引換金額' },
            { id: 'tax', title: 'うち消費税等' },
            { id: 'notifiaction1', title: '配達予定日通知 (お届け先)' },
            { id: 'notifiaction2', title: '配達完了通知 (お届け先)' },
            { id: 'notifiaction3', title: '不在持戻り通知 (お届け先)' },
            { id: 'notifiaction4', title: '郵便局留通知 (お届け先)' },
            { id: 'notifiaction5', title: '配達完了通知 (依頼主)' },
        ];

        const data = query_result_data.map(x => {
            const {
                userCollectionShippingName,
                userCollectionShippingZipcode,
                userCollectionShippingAddress,
                userCollectionShippingAddress2,
                userCollectionShippingAddress3,
                userCollectionShippingAddress4,
                userCollectionShippingTel
            } = x || {};

            return {
                product: 1, //may b change later
                cod: 0,
                golfSkiAirport: '',
                roundTrip: '',
                mailRecord: '',
                deliveryMethod: '',
                createCount: 1,
                userCollectionShippingName,
                recipientsTitle: '様',
                recipientsNameKana: '',
                userCollectionShippingZipcode,
                userCollectionShippingAddress,
                userCollectionShippingAddress2,
                userCollectionShippingAddress3,
                userCollectionShippingAddress4,
                userCollectionShippingTel,
                recipientsCompanyName: '',
                recipientsDepartmentName: '',
                recipientsEmail: '',
                airportAbbreviation: '',
                airportCode: '',
                recipientsName: '',
                systemYuPriName,
                senderTitle: '',
                semderNameKana: '',
                systemYuPriZipCode,
                systemYuPriPrefecture,
                systemYuPriAddress1,
                systemYuPriAddress2,
                systemYuPriAddress3,
                systemYuPriTelNo,
                systemYuPriCompanyName,
                senderDepartmentName: '',
                systemYuPriEmailAddress,
                itemName: 'トレカ（BOX）', //may b change later
                itemId: 1, //may b change later
                qty: 1,
                shippingDate: '',
                shippingTime: 0,
                security: 0,
                weight: 1000,
                damageAmount: '',
                coldStorage: 0,
                precaution1: 1,
                precaution2: 0,
                precaution3: 0,
                precaution4: 0,
                precaution5: 1,
                spare: 0,
                deliveryDate: '',
                deliveryTime: 0,
                receiveDate: '',
                receiveTime: '',
                clubCount: '',
                usageDate: '',
                usageTime: '',
                flightDate: '',
                bordingTime: '',
                flightNo: '',
                returnDate: '',
                paymentMethod: '',
                remarks: '',
                size: 60,
                sendingMethod: 1,
                discount: 0,
                codAmount: '',
                tax: '',
                notifiaction1: 0,
                notifiaction2: 0,
                notifiaction3: 0,
                notifiaction4: 0,
                notifiaction5: 1,
            }
        })

        // Define CSV column headers
        const csvWriter = createCsvWriter({
            path: '/tmp/' + TEMP_FILE_NAME, // Lambda function has write access to /tmp directory
            header: headers,
            append: false, // Set append to false to prevent the extra newline
        });

        await csvWriter.writeRecords(data);

        // Read the CSV file
        let csvFile = require('fs').readFileSync('/tmp/' + TEMP_FILE_NAME, 'utf-8');

        //For empty records this library generate a \n at the end of the file so remove it manually
        if (data.length == 0) {
            csvFile = csvFile.trimRight();
        }

        // Remove the header manually (According to Haga san)
        csvFile = csvFile.split('\n').slice(1).join('\n');

        return getResponse(csvFile, 200, { 'Content-Type': 'text/csv' })

    } catch (error) {
        console.error("error:", error)
        return getResponse(error, 400);
    } finally {
        if (mysql_con) await mysql_con.close();

        try {
            await cluster.disconnect();
        } catch (err) {
            console.log('Error occurred during disconnect cluster')
        }
    }

    function findFilterItem(findKeys = []) {
        let filterArr = filter ? JSON.parse(filter) : [];

        //For single level filter params ['name', 'contains', 'hi']
        if (filterArr.length == 3 && !filterArr.includes('and') && !filterArr.includes('or')) {
            filterArr = [filterArr];
        }

        return filterArr.find(([key, operator, value]) => findKeys.includes(key));
    }

    function getResponse(data, statusCode = 200, exHeaders = '') {
        let headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
        };

        if (exHeaders) headers = { ...headers, ...exHeaders };

        return {
            statusCode,
            headers,
            body: JSON.stringify(data),
        }
    }
};