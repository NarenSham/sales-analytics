const { GoogleGenerativeAI } = require('@google/generative-ai');

class MCPAnalyzer {
    constructor() {
        // Initialize Gemini with API key
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = genAI.getGenerativeModel({ model: "gemini-pro" });

        this.patterns = {
            select: /(?:find|show|get|what|display|list|give|what)/i,
            where: /(?:where|when|which|with)/i,
            groupBy: /(?:group by|grouped by|per)/i,
            orderBy: /(?:order by|sorted by|sort)/i,
            limit: /(?:limit|top|first|last)/i
        };
        
        this.entityPatterns = {
            sales: /(?:sales|revenue|income)/i,
            quantity: /(?:quantity|amount|count)/i,
            discount: /(?:discount|rebate)/i,
            profit: /(?:profit|gain|loss)/i,
            customer: /(?:customer|client|buyer|user)/i,
            customer_id: /(?:customer id|client id)/i,
            customer_name: /(?:customer name|client name)/i,
            segment: /(?:segment|category|group)/i,
            country: /(?:country|nation)/i,
            state: /(?:state|province|California|Texas|New York|Florida|Illinois|Ohio|Pennsylvania|Georgia|North Carolina|Michigan|New Jersey|Virginia|Washington|Arizona|Massachusetts|Tennessee|Indiana|Missouri|Maryland|Wisconsin|Colorado|Minnesota|South Carolina|Alabama|Louisiana|Kentucky|Oregon|Oklahoma|Connecticut|Iowa|Mississippi|Arkansas|Utah|Nevada|Kansas|New Mexico|West Virginia|Nebraska|Idaho|Hawaii|Maine|New Hampshire|Rhode Island|Montana|Delaware|South Dakota|North Dakota|Alaska|Vermont|Wyoming)/i,
            city: /(?:city|town)/i,
            region: /(?:region|area)/i,
            product: /(?:product|item|goods)/i,
            product_id: /(?:product id)/i,
            product_name: /(?:product name|item name)/i,
            category: /(?:category|type)/i,
            sub_category: /(?:sub-category|subcategory)/i,
            order_id: /(?:order id|order number)/i,
            order_date: /(?:order date|date of order)/i,
            ship_date: /(?:ship date|shipping date)/i,
            ship_mode: /(?:ship mode|shipping method)/i,
            postal_code: /(?:postal code|zip code)/i,
            month: /(?:month|monthly)/i,
            quarter: /(?:quarter|quarterly)/i,
            year: /(?:year|yearly)/i
        };

        // Add visualization patterns
        this.visualPatterns = {
            trend: /(?:trend|change|over time|growth)/i,
            comparison: /(?:compare|versus|vs|difference between)/i,
            distribution: /(?:distribution|spread|range)/i,
            relationship: /(?:relationship|correlation|connection)/i,
            composition: /(?:composition|breakdown|percentage|share)/i,
            flow: /(?:flow|process|sequence|steps)/i
        };

        this.db = require('./db/postgres');

        // Enhanced visualization patterns
        this.questionPatterns = {
            comparison: {
                patterns: [
                    /compare|versus|vs|difference|top|bottom|highest|lowest/i,
                    /which|who|what|show me/i
                ],
                subTypes: {
                    timeBased: /over time|trend|monthly|yearly|daily/i,
                    ranking: /top|bottom|best|worst|highest|lowest/i,
                    categorical: /by|per|across|among/i
                }
            },
            trend: {
                patterns: [
                    /trend|change|growth|decline|over time/i,
                    /how has|how did|track|progress/i
                ]
            },
            distribution: {
                patterns: [
                    /distribute|spread|range|variation/i,
                    /how many|what is the distribution/i
                ]
            },
            composition: {
                patterns: [
                    /breakdown|composition|make up|split|divide/i,
                    /what percent|proportion|share/i
                ]
            }
        };

        this.metricTypes = {
            currency: /sales|revenue|profit|cost|price/i,
            quantity: /count|number|amount|quantity/i,
            percentage: /percent|ratio|share|proportion/i,
            temporal: /date|time|year|month|day/i
        };

        // Add contextual patterns
        this.contextPatterns = {
            region: /\b(West|East|North|South)\b/i,
            timeframe: /\b(daily|weekly|monthly|yearly)\b/i,
            comparison: /\b(compared to|versus|vs)\b/i
        };
    }

    async analyzeUserFlow(processedFiles, analysisTypes) {
        try {
            // Default to all analysis types if none specified
            const types = analysisTypes || ['userFlows', 'components', 'api'];
            
            // Prepare the files content for analysis
            const filesSummary = processedFiles.map(file => ({
                path: file.path,
                type: file.type,
                content: file.content.substring(0, 1000) // Limit content size
            }));

            // Create specific prompts based on analysis types
            const prompts = {
                userFlows: `Analyze the user flows in these files and create a detailed mermaid diagram showing the flow between pages and components.`,
                components: `Analyze the component relationships and dependencies. Create a mermaid diagram showing component hierarchy and interactions.`,
                api: `Identify and document all API endpoints, their purposes, and parameters.`
            };

            const selectedPrompts = types
                .map(type => prompts[type])
                .join('\n\n');

            // Create the prompt for analysis
            const prompt = `
                Analyze these files and provide detailed insights:
                ${JSON.stringify(filesSummary, null, 2)}
                
                ${selectedPrompts}
                
                Also provide:
                1. Code quality insights and suggestions
                2. Potential security concerns
                3. Performance optimization opportunities
                
                Format the response as JSON with keys:
                - mermaidDiagram
                - componentDiagram (if components selected)
                - apiDocs (if api selected)
                - userFlows
                - codeInsights
            `;

            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const analysisText = response.text();

            // Parse the response
            let analysis;
            try {
                analysis = JSON.parse(analysisText);
            } catch (e) {
                analysis = this.getDefaultAnalysis();
            }

            return analysis;
        } catch (error) {
            console.error('Error in MCP analysis:', error);
            throw error;
        }
    }

    getDefaultAnalysis() {
        return {
            mermaidDiagram: 'graph TD\n    A[Start] --> B[Error parsing response]',
            userFlows: [{
                name: 'Error',
                description: 'Could not parse AI response',
                steps: ['Error occurred'],
                interactions: ['None']
            }],
            codeInsights: [{
                title: 'Analysis Error',
                description: 'Failed to generate detailed analysis',
                suggestions: ['Try analyzing specific parts of the codebase']
            }]
        };
    }

    async executeQuery(queryPlan) {
        try {
            let query = 'SELECT ' + queryPlan.operations
                .find(op => op.type === 'select')
                .fields.join(', ');
            
            query += ' FROM orders';

            const whereOp = queryPlan.operations.find(op => op.type === 'where');
            if (whereOp) {
                query += ' WHERE ' + whereOp.condition;
            }

            const groupOp = queryPlan.operations.find(op => op.type === 'group');
            if (groupOp) {
                query += ' GROUP BY ' + groupOp.by;
            }

            const orderOp = queryPlan.operations.find(op => op.type === 'order');
            if (orderOp) {
                query += ' ORDER BY ' + orderOp.by;
            }

            const limitOp = queryPlan.operations.find(op => op.type === 'limit');
            if (limitOp) {
                query += ' LIMIT ' + limitOp.value;
            }

            console.log('Executing query:', query);
            const result = await this.db.query(query);
            return result.rows;
        } catch (error) {
            console.error('Error executing query:', error);
            throw error;
        }
    }

    async generateVisualization(visualizationType, data) {
        try {
            const dataCharacteristics = this.analyzeDataCharacteristics(data);
            const visType = this.determineVisualization(visualizationType.question, dataCharacteristics);
            
            return {
                type: 'd3',
                chartType: visType.type || 'bar',
                orientation: visType.orientation || 'vertical',
                data: this.formatDataForVisualization(data, visType),
                config: {
                    ...visType.config,
                    title: this.generateTitle(visualizationType.question),
                    isCurrency: this.isCurrencyData(data),
                    axes: this.generateAxesConfig(data, visType)
                }
            };
        } catch (error) {
            console.error('Error generating visualization:', error);
            return {
                type: 'error',
                message: 'Failed to generate visualization'
            };
        }
    }

    formatDataForVisualization(data, visType) {
        if (!Array.isArray(data) || data.length === 0) {
            console.error('Invalid data format for visualization:', data);
            return [];
        }

        try {
            switch (visType.type) {
                case 'bar':
                    return data.map(row => ({
                        category: row.customer_name || row.category || 'Unknown',
                        value: parseFloat(row.total_sales || row.sales || row.value || 0)
                    }));
                case 'line':
                    return data.map(row => ({
                        date: row.order_date || row.date,
                        value: parseFloat(row.total_sales || row.sales || row.value || 0)
                    }));
                default:
                    return data;
            }
        } catch (error) {
            console.error('Error formatting data:', error);
            return [];
        }
    }

    determineVisualization(question, data, intent) {
        const visType = this.analyzeQuestionType(question);
        const metricType = this.analyzeMetricType(data);
        const dataCharacteristics = this.analyzeDataCharacteristics(data);

        return this.selectVisualization(visType, metricType, dataCharacteristics);
    }

    analyzeQuestionType(question) {
        const types = {
            comparison: false,
            trend: false,
            distribution: false,
            composition: false,
            subType: null
        };

        // Check each pattern type
        for (const [type, patterns] of Object.entries(this.questionPatterns)) {
            if (patterns.patterns.some(pattern => pattern.test(question))) {
                types[type] = true;
                
                // Check for subtypes
                if (patterns.subTypes) {
                    for (const [subType, pattern] of Object.entries(patterns.subTypes)) {
                        if (pattern.test(question)) {
                            types.subType = subType;
                            break;
                        }
                    }
                }
            }
        }

        return types;
    }

    analyzeMetricType(data) {
        const sampleValue = data[0] ? Object.values(data[0])[0] : null;
        const metrics = {
            isCurrency: false,
            isQuantity: false,
            isPercentage: false,
            isTemporal: false
        };

        // Check the data type
        if (sampleValue) {
            if (typeof sampleValue === 'number') {
                if (this.metricTypes.currency.test(Object.keys(data[0])[0])) {
                    metrics.isCurrency = true;
                } else if (this.metricTypes.percentage.test(Object.keys(data[0])[0])) {
                    metrics.isPercentage = true;
                } else {
                    metrics.isQuantity = true;
                }
            } else if (sampleValue instanceof Date || this.metricTypes.temporal.test(Object.keys(data[0])[0])) {
                metrics.isTemporal = true;
            }
        }

        return metrics;
    }

    analyzeDataCharacteristics(data) {
        // Ensure data is an array and not empty
        if (!Array.isArray(data) || data.length === 0) {
            return {
                recordCount: 0,
                hasTimeComponent: false,
                uniqueCategories: 0,
                isHierarchical: false
            };
        }

        return {
            recordCount: data.length,
            hasTimeComponent: data.some(row => row.date || row.order_date || row.timestamp),
            uniqueCategories: new Set(data.map(row => row.category || row.customer_name || row.name)).size,
            isHierarchical: this.checkForHierarchy(data)
        };
    }

    checkForHierarchy(data) {
        if (!Array.isArray(data) || data.length === 0) return false;

        // Check if data has parent-child relationships
        const hasParentChild = data.some(row => 
            row.parent_id || 
            row.parent || 
            row.category_parent || 
            (row.level !== undefined)
        );

        // Check if data has nested structures
        const hasNesting = data.some(row =>
            row.subcategory ||
            row.sub_category ||
            row.child_category
        );

        return hasParentChild || hasNesting;
    }

    selectVisualization(visType, metricType, dataCharacteristics) {
        // Decision tree for visualization selection
        if (visType.comparison) {
            if (visType.subType === 'ranking') {
                return {
                    type: 'bar',
                    orientation: 'horizontal',
                    config: {
                        sorted: true,
                        showValues: true,
                        animation: true
                    }
                };
            } else if (visType.subType === 'timeBased') {
                return {
                    type: 'line',
                    config: {
                        showPoints: true,
                        showTooltip: true,
                        animation: true
                    }
                };
            }
        }

        if (visType.trend && dataCharacteristics.hasTimeComponent) {
            return {
                type: 'line',
                config: {
                    showPoints: true,
                    showTooltip: true,
                    animation: true
                }
            };
        }

        if (visType.distribution) {
            if (dataCharacteristics.uniqueCategories > 10) {
                return {
                    type: 'histogram',
                    config: {
                        bins: Math.min(20, Math.ceil(Math.sqrt(dataCharacteristics.recordCount)))
                    }
                };
            } else {
                return {
                    type: 'bar',
                    orientation: 'vertical',
                    config: {
                        grouped: true
                    }
                };
            }
        }

        if (visType.composition) {
            if (dataCharacteristics.uniqueCategories <= 5) {
                return {
                    type: 'pie',
                    config: {
                        showPercentage: true,
                        donut: false
                    }
                };
            } else {
                return {
                    type: 'treemap',
                    config: {
                        showValues: true
                    }
                };
            }
        }

        // Default fallback
        return {
            type: 'bar',
            orientation: 'vertical',
            config: {
                showValues: true
            }
        };
    }

    async analyzeQuestion(question, context) {
        try {
            const intent = this.determineIntent(question);
            const entities = this.extractEntities(question);
            
            // Enhance entities with context
            if (context.activeFilters) {
                context.activeFilters.forEach((value, key) => {
                    entities[key] = value;
                });
            }

            const queryPlan = this.createQueryPlan(intent, entities);
            
            // Execute query with context-aware plan
            const data = await this.executeQuery(queryPlan);
            
            return {
                intent,
                entities,
                queryPlan,
                context,
                data,
                visualization: await this.generateVisualization({
                    question,
                    intent,
                    type: this.determineVisualizationType(question, entities)
                }, data)
            };
        } catch (error) {
            console.error('Error in analyzeQuestion:', error);
            throw error;
        }
    }

    determineIntent(question) {
        // Ensure question is a string
        if (!question || typeof question !== 'string') {
            throw new Error('Invalid question format');
        }

        const intent = {
            question: question,
            type: 'unknown',
            operation: null,
            entities: [],
            groupBy: null // Add a property to track grouping
        };

        // Determine the type of question
        if (this.patterns.select.test(question)) {
            intent.type = 'select';
        }
        if (this.patterns.where.test(question)) {
            intent.type = 'filter';
        }
        if (this.patterns.groupBy.test(question)) {
            intent.type = 'group';
        }
        if (this.patterns.orderBy.test(question)) {
            intent.type = 'sort';
        }
        if (this.patterns.limit.test(question)) {
            intent.type = 'limit';
        }

        // Check for temporal grouping
        if (/grouped by month/i.test(question)) {
            intent.groupBy = 'month'; // Set the grouping flag
        } else if (/grouped by quarter/i.test(question)) {
            intent.groupBy = 'quarter'; // Set for quarter if needed
        } else if (/grouped by year/i.test(question)) {
            intent.groupBy = 'year'; // Set for year if needed
        }

        // Determine operation based on patterns
        if (question.match(/top|highest|best/i)) {
            intent.operation = 'rank';
        } else if (question.match(/trend|over time|growth/i)) {
            intent.operation = 'trend';
        } else if (question.match(/compare|versus|vs/i)) {
            intent.operation = 'compare';
        } else if (question.match(/total|sum|aggregate/i)) {
            intent.operation = 'aggregate';
        }

        // Extract entities
        for (const [entity, pattern] of Object.entries(this.entityPatterns)) {
            if (pattern.test(question)) {
                intent.entities.push(entity);
            }
        }

        // Log the determined intent
        console.log('Determined Intent:', JSON.stringify(intent, null, 2));

        return intent;
    }

    extractEntities(question) {
        const entities = {};
        
        for (const [entity, pattern] of Object.entries(this.entityPatterns)) {
            if (pattern.test(question)) {
                entities[entity] = true; // Capture the entity if the pattern matches
            }
        }

        // Additional logic to capture specific state values
        const stateValues = [
            'California', 'Texas', 'New York', 'Florida', 'Illinois', 
            'Ohio', 'Pennsylvania', 'Georgia', 'North Carolina', 
            'Michigan', 'New Jersey', 'Virginia', 'Washington', 
            'Arizona', 'Massachusetts', 'Tennessee', 'Indiana', 
            'Missouri', 'Maryland', 'Wisconsin', 'Colorado', 
            'Minnesota', 'South Carolina', 'Alabama', 'Louisiana', 
            'Kentucky', 'Oregon', 'Oklahoma', 'Connecticut', 
            'Iowa', 'Mississippi', 'Arkansas', 'Utah', 
            'Nevada', 'Kansas', 'New Mexico', 'West Virginia', 
            'Nebraska', 'Idaho', 'Hawaii', 'Maine', 
            'New Hampshire', 'Rhode Island', 'Montana', 'Delaware', 
            'South Dakota', 'North Dakota', 'Alaska', 'Vermont', 
            'Wyoming'
        ];

        // Check if any state value is mentioned in the question
        for (const state of stateValues) {
            if (question.includes(state)) {
                entities.state = state; // Capture the specific state value
                break; // Exit loop once a match is found
            }
        }

        // Log the extracted entities
        console.log('Extracted Entities:', JSON.stringify(entities, null, 2));

        return entities;
    }

    createQueryPlan(intent, entities) {
        const plan = {
            dataSource: 'postgres',
            operations: []
        };

        // Add select operation
        const fields = this.determineFields(entities);
        plan.operations.push({
            type: 'select',
            fields: fields.length > 0 ? fields : this.defaultFields
        });

        // Initialize filter conditions array
        const filterConditions = [];

        // Add state filter if present
        if (entities.state) {
            filterConditions.push({
                field: 'state',
                operator: '=',
                value: entities.state // Use the specific state value captured
            });
        }

        // Add region filter if present
        if (entities.region) {
            filterConditions.push({
                field: 'region',
                operator: '=',
                value: entities.region // Use the specific region value captured
            });
        }

        // Add customer filter if present
        if (entities.customer) {
            filterConditions.push({
                field: 'customer_name',
                operator: '=',
                value: entities.customer // Use the specific customer value captured
            });
        }

        // Add any other entity-based filters as needed
        // Example for product filtering
        if (entities.product) {
            filterConditions.push({
                field: 'product_name',
                operator: '=',
                value: entities.product // Use the specific product value captured
            });
        }

        // If there are any filter conditions, add them to the plan
        if (filterConditions.length > 0) {
            plan.operations.push({
                type: 'filter',
                conditions: filterConditions
            });
        }

        // Log the created query plan for debugging
        console.log('Created Query Plan:', JSON.stringify(plan, null, 2));

        return plan;
    }

    isAggregateQuery(question) {
        return question.includes('total') || 
               question.includes('sum') || 
               question.includes('average') ||
               question.includes('top') ||
               question.includes('best');
    }

    isTrendQuery(question) {
        return question.includes('trend') || 
               question.includes('over time') ||
               question.includes('growth') ||
               question.includes('change');
    }

    isComparisonQuery(question) {
        return question.includes('compare') || 
               question.includes('versus') ||
               question.includes('vs') ||
               question.includes('difference');
    }

    createAggregateQueryPlan(question, entities) {
        const plan = {
            dataSource: 'postgres',
            operations: []
        };

        // Extract the number for top N queries
        const topN = this.extractTopN(question) || 5;

        plan.operations.push({
            type: 'select',
            fields: ['customer_name', 'SUM(sales) as total_sales']
        });

        plan.operations.push({
            type: 'where',
            condition: "EXTRACT(YEAR FROM order_date::timestamp) = 2015"
        });

        plan.operations.push({
            type: 'group',
            by: 'customer_name'
        });

        plan.operations.push({
            type: 'order',
            by: 'total_sales DESC'
        });

        plan.operations.push({
            type: 'limit',
            value: topN
        });

        return plan;
    }

    createTrendQueryPlan(question, entities) {
        const plan = {
            dataSource: 'postgres',
            operations: []
        };

        plan.operations.push({
            type: 'select',
            fields: ['DATE_TRUNC(\'month\', order_date) as month', 'SUM(sales) as total_sales']
        });

        plan.operations.push({
            type: 'where',
            condition: "EXTRACT(YEAR FROM order_date::timestamp) = 2015"
        });

        plan.operations.push({
            type: 'group',
            by: 'DATE_TRUNC(\'month\', order_date)'
        });

        plan.operations.push({
            type: 'order',
            by: 'month ASC'
        });

        return plan;
    }

    createComparisonQueryPlan(question, entities) {
        const plan = {
            dataSource: 'postgres',
            operations: []
        };

        if (entities.customers) {
            plan.operations.push({
                type: 'select',
                fields: ['customer_name', 'SUM(sales) as total_sales']
            });
            plan.operations.push({
                type: 'group',
                by: 'customer_name'
            });
        } else if (entities.products) {
            plan.operations.push({
                type: 'select',
                fields: ['product_name', 'SUM(sales) as total_sales']
            });
            plan.operations.push({
                type: 'group',
                by: 'product_name'
            });
        }

        plan.operations.push({
            type: 'where',
            condition: "EXTRACT(YEAR FROM order_date::timestamp) = 2015"
        });

        plan.operations.push({
            type: 'order',
            by: 'total_sales DESC'
        });

        return plan;
    }

    createDefaultQueryPlan(question, entities) {
        return {
            dataSource: 'postgres',
            operations: [
                {
                    type: 'select',
                    fields: ['order_date', 'customer_name', 'sales']
                },
                {
                    type: 'where',
                    condition: "EXTRACT(YEAR FROM order_date::timestamp) = 2015"
                },
                {
                    type: 'order',
                    by: 'order_date ASC'
                }
            ]
        };
    }

    extractTopN(question) {
        const match = question.match(/top\s+(\d+)/i);
        return match ? parseInt(match[1]) : null;
    }

    determineDataSource(entities) {
        // Logic to determine whether to use PostgreSQL or Excel
        // based on the entities and available data
        if (entities.sales || entities.products) {
            return 'postgres';
        }
        return 'excel';
    }

    determineFields(entities) {
        const fields = [];
        if (entities.sales) fields.push('sales', 'order_date');
        if (entities.products) fields.push('product_name', 'price');
        if (entities.customers) fields.push('customer_name', 'email');
        return fields.length > 0 ? fields : ['*'];
    }

    extractWhereConditions(question) {
        // Basic condition extraction
        const conditions = [];
        const words = question.split(' ');
        
        for (let i = 0; i < words.length; i++) {
            if (this.patterns.where.test(words[i])) {
                conditions.push({
                    field: words[i + 1],
                    operator: '=',
                    value: words[i + 2]
                });
            }
        }

        return conditions;
    }

    extractGrouping(question) {
        const words = question.split(' ');
        for (let i = 0; i < words.length; i++) {
            if (this.patterns.groupBy.test(words[i])) {
                return words[i + 1];
            }
        }
        return null;
    }

    extractOrdering(question) {
        const words = question.split(' ');
        for (let i = 0; i < words.length; i++) {
            if (this.patterns.orderBy.test(words[i])) {
                return {
                    field: words[i + 1],
                    direction: words[i + 2]?.toLowerCase() === 'desc' ? 'DESC' : 'ASC'
                };
            }
        }
        return null;
    }

    async generateSlide(question, visualization, data) {
        const title = this.generateTitle(question);
        const visualizationResult = await this.generateVisualization(visualization, data);
        
        // Add HTML generation
        const slideHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <script type="module">
                    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
                    mermaid.initialize({ startOnLoad: true });
                </script>
            </head>
            <body>
                <h1>${title}</h1>
                <div class="mermaid">
                    ${visualizationResult.diagram}
                </div>
            </body>
            </html>
        `;

        return {
            title,
            visualizationResult,
            slideHtml
        };
    }

    generateTitle(question) {
        // Remove question words and create a title
        return question
            .replace(/^(show|display|give|get|what|how|when|where|who|list|find)/i, '')
            .replace(/\?$/, '')
            .trim()
            .charAt(0).toUpperCase() + question.slice(1);
    }

    generateLegend(visualization) {
        return {
            items: [],
            position: 'bottom',
            style: {
                display: 'flex',
                justifyContent: 'center',
                gap: '20px'
            }
        };
    }

    determineVisualizationType(question, entities) {
        // Check for explicit visualization requests
        if (question.match(/show|display|visualize/i)) {
            if (question.match(/pie|donut|circle/i)) return 'pie';
            if (question.match(/bar|column/i)) return 'bar';
            if (question.match(/line|trend|over time/i)) return 'line';
            if (question.match(/tree|hierarchy/i)) return 'treemap';
        }

        // Determine by question type
        if (question.match(/compare|versus|vs|difference/i)) {
            return 'bar';
        }
        if (question.match(/trend|change|growth|over time/i)) {
            return 'line';
        }
        if (question.match(/distribution|spread|range/i)) {
            return 'histogram';
        }
        if (question.match(/composition|breakdown|percentage|share/i)) {
            return entities.length > 5 ? 'treemap' : 'pie';
        }

        // Default to bar for rankings and simple comparisons
        if (question.match(/top|bottom|best|worst|highest|lowest/i)) {
            return 'bar';
        }

        // Default visualization based on entities
        if (entities.dates) {
            return 'line';
        }
        
        return 'bar';
    }

    async executePostgresQuery(plan) {
        try {
            let query = 'SELECT ';
            const selectOp = plan.operations.find(op => op.type === 'select');
            
            const fields = (selectOp?.fields?.length > 0) ? selectOp.fields : this.defaultFields;
            query += fields.join(', ');
            
            query += ' FROM orders';
            query += " WHERE EXTRACT(YEAR FROM order_date::timestamp) = 2015";

            const groupOp = plan.operations.find(op => op.type === 'group');
            if (groupOp) {
                query += ' GROUP BY ' + groupOp.by;
            }

            const orderOp = plan.operations.find(op => op.type === 'order');
            if (orderOp) {
                query += ' ORDER BY ' + orderOp.by;
            }

            const limitOp = plan.operations.find(op => op.type === 'limit');
            if (limitOp) {
                query += ' LIMIT ' + limitOp.value;
            }

            console.log('Final query:', query);
            const result = await this.pgPool.query(query);
            return result.rows;
        } catch (error) {
            console.error('PostgreSQL query error:', error);
            throw error;
        }
    }

    isCurrencyData(data) {
        return data.some(row => 
            row.sales !== undefined || 
            row.revenue !== undefined || 
            row.price !== undefined
        );
    }

    generateAxesConfig(data, visType) {
        const config = {
            x: { label: '', format: null },
            y: { label: '', format: null }
        };

        if (visType.type === 'line') {
            config.x.label = 'Date';
            config.y.label = this.isCurrencyData(data) ? 'Sales ($)' : 'Value';
            config.y.format = this.isCurrencyData(data) ? 'currency' : 'number';
        } else if (visType.type === 'bar') {
            if (visType.orientation === 'horizontal') {
                config.y.label = 'Category';
                config.x.label = this.isCurrencyData(data) ? 'Sales ($)' : 'Value';
                config.x.format = this.isCurrencyData(data) ? 'currency' : 'number';
            } else {
                config.x.label = 'Category';
                config.y.label = this.isCurrencyData(data) ? 'Sales ($)' : 'Value';
                config.y.format = this.isCurrencyData(data) ? 'currency' : 'number';
            }
        }

        return config;
    }
}

module.exports = MCPAnalyzer; 