const dateColumnList = [
    'itemUpdatedAt', 'itemCreatedAt',
    'gachaPostStartDate', 'gachaStartDate', 'gachaEndDate', 'gachaUpdatedAt', 'gachaBuiltedAt',
    'userCollectionRequestAt', 'userCollectionUpdatedAt', 'userCollectionShippedAt', 'userCollectionCreatedAt',
    'userPointLastPurchaseAt', 'userCreatedAt', 'userLastLoginAt', 'userUpdatedAt', 'userPointLastGachaAt', 'userSMSAuthenticatedAt',
    'couponStartDate', 'couponEndDate', 'couponUpdatedAt',
    'accountUpdatedAt', 'accountLastLoginAt', 'userLastActiveAt',
    'userPaymentHistoryCreatedAt',
];

const binaryUuidColumnList = [
    'userCollectionTransactionUUID', 'itemUUID', 'userUUID'
];


exports.getWhereFromFilter = (filter, mapperKeys = {}, havingKeys = []) => {
    let queryObj = JSON.parse(filter);

    let whereConditionParameters = [];
    let havingConditionParameters = [];

    if (!Array.isArray(queryObj) || (Array.isArray(queryObj) && queryObj.length == 0)) {
        return {
            condition: '',
            conditionParameters: whereConditionParameters,
            havingCondition: '',
            havingConditionParameters: havingConditionParameters
        }
    }

    const generateConditionPlaceholder = (queryObj = []) => {
        const [field, operator, value] = queryObj;

        let modifiedOperator = operator;
        let modifiedValue = value;
        let modifiedKey = mapperKeys.hasOwnProperty(field) ? mapperKeys[field] : field;

        if (value) {
            if (dateColumnList.includes(field)) {
                modifiedValue = value / 1000  // Convert milliseconds to seconds
            }
            else if (binaryUuidColumnList.includes(field)) {
                modifiedKey = `BIN_TO_UUID(${modifiedKey})`;
            }
        }

        switch (operator) {
            case 'contains':
                if (Array.isArray(value)) {
                    modifiedOperator = 'IN';
                } else {
                    modifiedOperator = 'LIKE';
                    modifiedValue = '%' + value + '%';
                }
                break;
            case 'notcontains':
                modifiedOperator = 'Not LIKE';
                modifiedValue = '%' + value + '%';
                break;
            case 'startswith':
                modifiedOperator = 'LIKE';
                modifiedValue = value + '%';
                break;
            case 'endswith':
                modifiedOperator = 'LIKE';
                modifiedValue = '%' + value;
                break;
            //.... Other case need to right here
        }

        let placeholder = '';
        let values = undefined;

        //Handle where IN
        if (Array.isArray(modifiedValue)) {
            placeholder = `(${modifiedKey} ${modifiedOperator} (?)  OR ?)`;

            if (modifiedValue.length > 0) values = [modifiedValue, false]; //In this case (?) will appliy
            else values = [null, true]; //In this case OR ? will appliy
        }
        //Except others
        else {
            placeholder = `${modifiedKey} ${modifiedOperator} ?`;
            values = modifiedValue;
        }

        return { placeholder, values };
    }


    //Distinguish where/having conditions
    const separateConditions = (conditions = [], isMultiLevel = false) => {
        let havingConditionFound = false;

        let whereConditionArr = [];
        let havingConditionArr = [];
        let multilevelConditions = []

        for (const condition of conditions) {

            if (Array.isArray(condition) && condition.includes('and')) { //For multi-level filter params EX: [["itemUUID","contains","33"],"and",["categoryName","contains","44"]]
                console.log('my check ----->>>>', condition)

                const { havingConditionFound, multilevelConditions } = separateConditions(condition, true);

                if (havingConditionFound) havingConditionArr.push(multilevelConditions);
                else whereConditionArr.push(multilevelConditions);
            }
            //For single level filter params EX: ['name', 'contains', 'hi']
            else if (Array.isArray(condition) && !condition.includes('and')) {
                const [field, operator, value] = condition || [];

                if (!isMultiLevel) {
                    if (havingKeys.includes(field)) havingConditionArr.push(condition);
                    else whereConditionArr.push(condition);
                }
                else {
                    if (havingKeys.includes(field)) havingConditionFound = true;
                    multilevelConditions.push(condition);
                }
            }
        }

        if (isMultiLevel) {
            return {
                havingConditionFound,
                multilevelConditions
            }
        }

        return {
            whereConditionArr,
            havingConditionArr
        };
    }

    const isMultidimensionalArray = arr => arr.some(Array.isArray);
    const countTwoDimensionalArrays = arr => arr.filter(innerArray => Array.isArray(innerArray)).length;

    let conditionArray = queryObj;
    if (conditionArray.length == 3 && !conditionArray.includes('and')) conditionArray = [conditionArray];  //Ex: ['name', 'includes', 'foo] => [['name', 'includes', 'foo]]

    const { whereConditionArr, havingConditionArr } = separateConditions(conditionArray);

    console.log('my separated where : ', whereConditionArr)
    console.log('my separated havingConditionArr : ', havingConditionArr)

    //Generate mysql where/having condition string from array conditions
    const generateSqlConditions = (condtionsArr = [], conditionType = 'where') => {
        return condtionsArr.map(condition => {
            console.log('my multiple cond is ', condition)
            console.log('my multiple isMultidimensionalArray is ', isMultidimensionalArray(condition))
            console.log('my multiple countTwoDimensionalArrays is ', countTwoDimensionalArrays(condition))

            if (isMultidimensionalArray(condition) && countTwoDimensionalArrays(condition) > 1) {

                const multilevelConditionPlaceholder = generateSqlConditions(condition).join(' AND ');

                return `(${multilevelConditionPlaceholder})`
            }
            else {
                const { placeholder, values } = generateConditionPlaceholder(condition);

                if (conditionType == 'where') Array.isArray(values) ? whereConditionParameters = [...whereConditionParameters, ...values] : whereConditionParameters.push(values);
                else if (conditionType == 'having') Array.isArray(values) ? havingConditionParameters = [...havingConditionParameters, ...values] : havingConditionParameters.push(values);

                return placeholder;
            }
        })
    }

    const sqlWhereConditionStr = generateSqlConditions(whereConditionArr, 'where').join(' AND ');

    console.log('my separated sqlWhereConditionStr : ', sqlWhereConditionStr)
    console.log('my separated whereConditionParameters : ', whereConditionParameters)

    const sqlHavingConditionStr = generateSqlConditions(havingConditionArr, 'having').join(' AND ');

    console.log('my separated sqlHavingConditionStr : ', sqlHavingConditionStr)
    console.log('my separated havingConditionParameters : ', havingConditionParameters)

    return {
        condition: sqlWhereConditionStr ? ` WHERE ${sqlWhereConditionStr} ` : '',
        conditionParameters: whereConditionParameters,
        havingCondition: sqlHavingConditionStr ? ` HAVING ${sqlHavingConditionStr} ` : '',
        havingConditionParameters: havingConditionParameters
    }
}