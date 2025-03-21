const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Pool } = require('pg');
const fetch = require('node-fetch');
const { Headers } = require('node-fetch');

// Make both fetch and Headers available globally
global.fetch = fetch;
global.Headers = Headers;

class ModelContextProtocol {
    constructor() {
        try {
            this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            this.model = this.genAI.getGenerativeModel({ model: "models/gemini-1.5-pro" });
            
            this.pgPool = new Pool({
                user: process.env.DB_USER,
                host: process.env.DB_HOST,
                database: process.env.DB_NAME,
                password: process.env.DB_PASSWORD,
                port: process.env.DB_PORT,
            });

            // Define data sources and their entities
            this.dataSources = {
                orders: {
                    temporal: ['order_date', 'ship_date'],
                    categorical: [
                        'region', 'customer_name', 'segment', 'country', 'city', 
                        'state', 'category', 'sub_category', 'product_name', 'ship_mode'
                    ],
                    metrics: ['sales', 'quantity', 'discount', 'profit']
                }
            };

            // Initialize context memory
            this.contextMemory = new Map();

            // Enhanced visualization mappings based on the cheat sheet
            this.visualizationTypes = {
                comparison: {
                    timeSeries: {
                        type: 'line',
                        config: {
                            orientation: 'vertical',
                            axisFormats: {
                                x: 'date',
                                y: 'currency'
                            }
                        }
                    },
                    ranking: {
                        type: 'bar',
                        config: {
                            orientation: 'horizontal',
                            axisFormats: {
                                x: 'currency',
                                y: 'category'
                            }
                        }
                    },
                    categorical: {
                        type: 'bar',
                        config: {
                            orientation: 'vertical',
                            axisFormats: {
                                x: 'category',
                                y: 'currency'
                            }
                        }
                    }
                },
                distribution: {
                    single: {
                        type: 'histogram',
                        config: {
                            orientation: 'vertical',
                            axisFormats: {
                                x: 'bucket',
                                y: 'count'
                            }
                        }
                    },
                    relationship: {
                        type: 'scatter',
                        config: {
                            axisFormats: {
                                x: 'number',
                                y: 'number'
                            }
                        }
                    }
                },
                composition: {
                    static: {
                        type: 'pie',
                        config: {
                            showLabels: true,
                            showPercentages: true
                        }
                    },
                    relative: {
                        type: 'stacked-bar',
                        config: {
                            orientation: 'vertical',
                            axisFormats: {
                                x: 'category',
                                y: 'percentage'
                            }
                        }
                    }
                }
            };

            this.sessionContexts = new Map();

            console.log('ModelContextProtocol initialized successfully');
        } catch (error) {
            console.error('Error in ModelContextProtocol constructor:', error);
            throw error;
        }
    }

    getContext(sessionId) {
        if (!this.sessionContexts.has(sessionId)) {
            this.sessionContexts.set(sessionId, {
                lastState: null,
                lastYear: null,
                lastMetric: 'sales',
                lastLimit: 5,
                questions: []
            });
        }
        return this.sessionContexts.get(sessionId);
    }

    enhanceQuestionWithContext(question, context) {
        const q = question.toLowerCase();
        
        // Handle follow-up questions
        if (context.questions.length > 0) {
            // Add state context if missing
            if (!q.includes('in') && context.lastState && 
                (q.includes('top') || q.includes('sales'))) {
                return `${question} in ${context.lastState}`;
            }

            // Handle "how about" questions
            if (q.includes('how about') && context.lastState) {
                return question.replace(/how about/i, 
                    `show ${context.lastMetric} in`);
            }
        }

        return question;
    }

    async processQuestion(question, sessionId) {
        const startTime = Date.now();
        try {
            // Get context and enhance question
            const context = this.getContext(sessionId);
            const enhancedQuestion = this.enhanceQuestionWithContext(question, context);
            
            // Extract entities with context awareness
            const { entities, sourceType } = this.extractEntitiesAndSource(enhancedQuestion, context);
            
            const isComparisonQuery = enhancedQuestion.toLowerCase().includes('compare') || 
                                    enhancedQuestion.toLowerCase().includes('vs') || 
                                    enhancedQuestion.toLowerCase().includes('versus');
            
            // Extract year if present
            const year = this.extractYear(enhancedQuestion);

            let result;
            if (isComparisonQuery) {
                const states = this.extractComparisonStates(enhancedQuestion);
                if (!states || states.length < 2) {
                    throw new Error('Could not identify states to compare');
                }

                const whereConditions = [`state IN ('${states.join('\', \'')}')`];
                if (year) {
                    whereConditions.push(`EXTRACT(YEAR FROM order_date) = ${year}`);
                }

                const queryPlan = {
                    select: [
                        'DATE_TRUNC(\'month\', order_date) as month',
                        'state',
                        'SUM(sales) as total_sales'
                    ],
                    from: 'orders',
                    where: whereConditions,
                    groupBy: ['DATE_TRUNC(\'month\', order_date)', 'state'],
                    orderBy: ['month ASC, state']
                };

                const data = await this.executeQuery(queryPlan);
                
                const groupedData = {};
                states.forEach(state => {
                    groupedData[state] = data
                        .filter(row => row.state === state)
                        .map(row => ({
                            x: new Date(row.month).toISOString(),
                            y: parseFloat(row.total_sales)
                        }));
                });

                result = {
                    success: true,
                    data: {
                        title: `Sales Comparison: ${states.join(' vs ')}${year ? ` (${year})` : ''}`,
                        subtitle: `Monthly sales trend comparison`,
                        visualization: {
                            type: 'multi-line',
                            data: states.map(state => ({
                                name: state,
                                values: groupedData[state]
                            })),
                            config: {
                                width: 800,
                                height: 400,
                                margin: { top: 20, right: 120, bottom: 40, left: 60 },
                                xAxis: {
                                    label: 'Month',
                                    format: 'date'
                                },
                                yAxis: {
                                    label: 'Sales ($)',
                                    format: 'currency'
                                }
                            }
                        },
                        insights: this.calculateMultiSeriesInsights(groupedData),
                        rawData: data
                    }
                };

            } else if (enhancedQuestion.toLowerCase().includes('top')) {
                // Handle ranking queries (e.g., "top 5 customers")
                const limit = this.extractLimit(enhancedQuestion) || 5;
                const whereConditions = [];
                
                // Add geographic filter if present
                if (entities.geographic) {
                    whereConditions.push(`state = '${entities.geographic}'`);
                }
                
                // Add year filter if present
                if (year) {
                    whereConditions.push(`EXTRACT(YEAR FROM order_date) = ${year}`);
                }

                const queryPlan = {
                    select: ['customer_name', 'SUM(sales) as total_sales'],
                    from: 'orders',
                    where: whereConditions,
                    groupBy: ['customer_name'],
                    orderBy: ['total_sales DESC'],
                    limit: limit
                };

                const data = await this.executeQuery(queryPlan);
                
                result = {
                    success: true,
                    data: {
                        title: `Top ${limit} Customers${entities.geographic ? ` in ${entities.geographic}` : ''}${year ? ` (${year})` : ''}`,
                        subtitle: 'Ranked by total sales',
                        visualization: {
                            type: 'horizontal-bar',
                            data: data.map(row => ({
                                label: row.customer_name,
                                value: parseFloat(row.total_sales)
                            })),
                            config: {
                                width: 800,
                                height: 400,
                                margin: { top: 20, right: 30, bottom: 40, left: 200 },
                                xAxis: {
                                    label: 'Sales ($)',
                                    format: 'currency'
                                },
                                yAxis: {
                                    label: 'Customer',
                                    format: 'text'
                                }
                            }
                        },
                        insights: this.calculateRankingInsights(data, year),
                        rawData: data
                    }
                };
            } else {
                // Determine if this is a trend/time series question
                const isTrendQuery = !enhancedQuestion.toLowerCase().includes('top');
                
                let queryPlan;
                if (isTrendQuery) {
                    queryPlan = {
                        select: ['DATE_TRUNC(\'month\', order_date) as month', 'SUM(sales) as total_sales'],
                        from: 'orders',
                        where: entities.geographic ? [`state = '${entities.geographic}'`] : [],
                        groupBy: ['DATE_TRUNC(\'month\', order_date)'],
                        orderBy: ['month ASC']
                    };

                    const data = await this.executeQuery(queryPlan);
                    
                    result = {
                        success: true,
                        data: {
                            title: `Monthly Sales Trend${entities.geographic ? ` in ${entities.geographic}` : ''}`,
                            subtitle: `From ${new Date(data[0].month).toLocaleDateString()} to ${new Date(data[data.length-1].month).toLocaleDateString()}`,
                            visualization: {
                                type: 'line',
                                data: data.map(row => ({
                                    x: new Date(row.month).toISOString(),
                                    y: parseFloat(row.total_sales)
                                })),
                                config: {
                                    width: 800,
                                    height: 400,
                                    margin: { top: 20, right: 30, bottom: 40, left: 60 },
                                    xAxis: {
                                        label: 'Month',
                                        format: 'date'
                                    },
                                    yAxis: {
                                        label: 'Sales ($)',
                                        format: 'currency'
                                    }
                                }
                            },
                            insights: this.calculateInsights(data),
                            rawData: data
                        }
                    };
                } else {
                    // Existing ranking query logic
                    queryPlan = {
                        select: ['customer_name', 'SUM(sales) as total_sales'],
                        from: 'orders',
                        where: entities.geographic ? [`state = '${entities.geographic}'`] : [],
                        groupBy: ['customer_name'],
                        orderBy: ['total_sales DESC'],
                        limit: 5
                    };

                    const data = await this.executeQuery(queryPlan);
                    
                    result = {
                        success: true,
                        data: {
                            title: `Top 5 Customers${entities.geographic ? ` in ${entities.geographic}` : ''}`,
                            subtitle: 'Ranked by total sales',
                            visualization: {
                                type: 'horizontal-bar',
                                data: data.map(row => ({
                                    label: row.customer_name,
                                    value: parseFloat(row.total_sales)
                                })),
                                config: {
                                    width: 800,
                                    height: 400,
                                    margin: { top: 20, right: 30, bottom: 40, left: 200 },
                                    xAxis: {
                                        label: 'Sales ($)',
                                        format: 'currency'
                                    },
                                    yAxis: {
                                        label: 'Customer',
                                        format: 'text'
                                    }
                                }
                            },
                            insights: this.calculateInsights(data),
                            rawData: data
                        }
                    };
                }
            }

            // Update context with new information
            this.updateContext(sessionId, result, entities);

            return result;
        } catch (error) {
            console.error('Error processing question:', error);
            this.logError(error, { question, sessionId, executionTime: Date.now() - startTime });
            throw error;
        }
    }

    validateQuestion(question) {
        if (!question || typeof question !== 'string') {
            throw new Error(this.errorTypes.INVALID_QUESTION);
        }
        if (question.length > 500) {
            throw new Error('Question too long (max 500 characters)');
        }
        if (question.length < 3) {
            throw new Error('Question too short');
        }
        // Check for SQL injection attempts
        if (question.match(/;|\bDROP\b|\bDELETE\b|\bUPDATE\b|\bINSERT\b/i)) {
            throw new Error('Invalid question content');
        }
    }

    extractEntitiesAndSource(question, context) {
        try {
            const entities = {
                temporal: [],
                categorical: [],
                metrics: [],
                filters: new Map(context.filters),
                geographic: null
            };

            // Extract state information
            const statePattern = /\b(?:in|for)\s+([A-Za-z\s]+?)(?=\s+|$)/i;
            const stateMatch = question.match(statePattern);
            if (stateMatch) {
                entities.geographic = stateMatch[1].trim();
            }

            // Extract temporal information
            const datePatterns = {
                absolute: /\b\d{4}(-\d{2}(-\d{2})?)?\b/,
                relative: /\b(last|this|next)\s+(day|week|month|year)\b/i,
                range: /\bbetween\s+.*?\s+and\s+.*?\b/i
            };

            for (const [type, pattern] of Object.entries(datePatterns)) {
                const matches = question.match(pattern);
                if (matches) {
                    entities.temporal.push({
                        type,
                        value: matches[0]
                    });
                }
            }

            return { entities, sourceType: 'orders' };
        } catch (error) {
            console.error('Error in extractEntitiesAndSource:', error);
            return {
                entities: {
                    temporal: [],
                    categorical: [],
                    metrics: [],
                    filters: new Map(),
                    geographic: null
                },
                sourceType: 'orders'
            };
        }
    }

    async analyzeWithLLM(question, entities, context) {
        try {
            // Fix the prompt format for Gemini
            const prompt = {
                text: `Analyze this business question: "${question}"

Instructions: Return a JSON analysis determining the appropriate query and visualization type.

Example for "top 5 customers in California":
{
    "analysis": {
        "type": "comparison",
        "subtype": "ranking",
        "metrics": ["sales"],
        "dimensions": ["customer_name"],
        "filters": {
            "geographic": "California",
            "temporal": null
        },
        "limit": 5
    },
    "query": {
        "aggregation": "SUM",
        "orderBy": "DESC"
    },
    "visualization": {
        "type": "bar-horizontal",
        "config": {
            "title": "Top 5 Customers by Sales in California",
            "subtitle": "Ranked by total sales",
            "axes": {
                "x": {"label": "Sales ($)", "format": "currency"},
                "y": {"label": "Customer", "format": "text"}
            }
        }
    }
}`
            };

            const result = await this.model.generateContent({
                contents: [{ role: "user", parts: [prompt] }],
                generationConfig: {
                    temperature: 0.1,
                    topK: 1,
                    topP: 0.1,
                }
            });

            const response = await result.response;
            const analysis = JSON.parse(response.text());

            // Build query plan based on analysis
            return this.transformAnalysisToQueryPlan(analysis, entities);
        } catch (error) {
            console.error('LLM Analysis Error:', error);
            // Use ranking-specific fallback for "top N" questions
            if (question.toLowerCase().includes('top')) {
                return {
                    queryPlan: {
                        select: ['customer_name', 'SUM(sales) as total_sales'],
                        from: 'orders',
                        where: ['state = \'California\''],
                        groupBy: ['customer_name'],
                        orderBy: ['total_sales DESC'],
                        limit: 5
                    },
                    visualization: {
                        type: 'bar-horizontal',
                        config: {
                            title: 'Top 5 Customers by Sales in California',
                            subtitle: 'Ranked by total sales',
                            axes: {
                                x: { label: 'Sales ($)', format: 'currency' },
                                y: { label: 'Customer', format: 'text' }
                            }
                        }
                    }
                };
            }
            return this.getFallbackAnalysis(question, entities);
        }
    }

    transformAnalysisToQueryPlan(analysis, entities) {
        const queryPlan = {
            select: [],
            from: 'orders',
            where: [],
            groupBy: [],
            orderBy: [],
            limit: analysis.analysis.limit || null
        };

        // Handle dimensions (e.g., customer_name)
        analysis.analysis.dimensions.forEach(dimension => {
            queryPlan.select.push(dimension);
            queryPlan.groupBy.push(dimension);
        });

        // Handle metrics with aggregation
        analysis.analysis.metrics.forEach(metric => {
            queryPlan.select.push(`${analysis.query.aggregation}(${metric}) as total_${metric}`);
        });

        // Handle geographic filters
        if (analysis.analysis.filters.geographic) {
            queryPlan.where.push(`state = '${analysis.analysis.filters.geographic}'`);
        }

        // Handle ordering
        if (analysis.query.orderBy) {
            const metric = analysis.analysis.metrics[0];
            queryPlan.orderBy.push(`total_${metric} ${analysis.query.orderBy}`);
        }

        return {
            queryPlan,
            visualization: analysis.visualization
        };
    }

    getFallbackAnalysis(question, entities) {
        if (question.toLowerCase().includes('top')) {
            return {
                queryPlan: {
                    select: ['customer_name', 'SUM(sales) as sales_total'],
                    from: 'orders',
                    where: entities.geographic ? [`state = '${entities.geographic}'`] : [],
                    groupBy: ['customer_name'],
                    orderBy: ['sales_total DESC'],
                    limit: 5
                },
                visualization: {
                    type: 'bar-horizontal',
                    config: {
                        title: 'Top Customers by Sales',
                        subtitle: entities.geographic ? `in ${entities.geographic}` : 'Overall',
                        axes: {
                            x: { label: 'Sales', format: 'currency' },
                            y: { label: 'Customer', format: 'text' }
                        }
                    }
                }
            };
        }
        // ... existing default time series analysis ...
    }

    isValidAnalysisStructure(analysis) {
        return (
            analysis &&
            analysis.intent &&
            analysis.intent.type &&
            analysis.visualization &&
            analysis.visualization.type &&
            analysis.visualization.config &&
            analysis.visualization.config.title &&
            analysis.visualization.config.axes
        );
    }

    calculateInsights(data) {
        if (!data || data.length === 0) {
            return 'No data available for insights.';
        }

        // Calculate insights using native JavaScript
        const total = data.reduce((sum, row) => sum + parseFloat(row.total_sales || row.sales || 0), 0);
        const avg = total / data.length;
        
        return `Total Sales: $${total.toLocaleString('en-US', { maximumFractionDigits: 0 })}
Average: $${avg.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    }

    buildQueryPlan(intent, sourceType, entities, question) {
        const queryPlan = {
            select: [],
            from: sourceType,
            where: [],
            groupBy: [],
            orderBy: [],
            limit: null
        };

        // Look for state in the question using a more flexible pattern
        const statePattern = /(?:in|for)\s+(\w+)(?:\s|$)/i;
        const stateMatch = question.match(statePattern);
        const state = stateMatch ? stateMatch[1] : null;

        // Add state condition if present, with proper case handling
        if (state) {
            // Capitalize first letter of each word
            const formattedState = state.split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');
            queryPlan.where.push(`state = '${formattedState}'`);
        }

        // Always include these for time series visualization
        const monthTrunc = `DATE_TRUNC('month', order_date)`;
        queryPlan.select.push(`${monthTrunc} as month`);
        queryPlan.select.push(`SUM(sales) as total_sales`);
        if (state) {
            queryPlan.select.push(`'${state}' as state`);
        }
        queryPlan.groupBy.push(monthTrunc);
        queryPlan.orderBy.push(`${monthTrunc} ASC`);

        return queryPlan;
    }

    sanitizeQueryPlan(queryPlan) {
        // Validate all field names against schema
        const validFields = new Set([
            ...this.dataSources.orders.temporal,
            ...this.dataSources.orders.categorical,
            ...this.dataSources.orders.metrics,
            'DATE_TRUNC'  // Add this to allow DATE_TRUNC function
        ]);

        // Helper function to validate SQL expressions
        const isValidExpression = (expr) => {
            // Allow DATE_TRUNC expressions
            if (expr.includes('DATE_TRUNC')) {
                return true;
            }
            // For simple fields, check against valid fields
            const baseField = expr.split(' as ')[0]
                .replace(/^SUM\(|\)$/g, '')
                .replace(/.*\./, ''); // Remove table alias if present
            return validFields.has(baseField);
        };

        // Sanitize SELECT fields
        queryPlan.select = queryPlan.select.filter(field => isValidExpression(field));

        // Sanitize WHERE conditions
        queryPlan.where = queryPlan.where.filter(condition => {
            const field = condition.split(/\s+/)[0];
            return validFields.has(field.replace(/.*\./, '')); // Remove table alias if present
        });

        // Sanitize GROUP BY fields
        queryPlan.groupBy = queryPlan.groupBy.filter(field => isValidExpression(field));

        // Sanitize ORDER BY fields
        queryPlan.orderBy = queryPlan.orderBy.filter(field => isValidExpression(field.replace(/ ASC| DESC/i, '')));

        return queryPlan;
    }

    buildRelativeDateCondition(temporal) {
        const now = new Date();
        let condition = '';

        switch (temporal.toLowerCase()) {
            case 'last month':
                condition = `${this.dataSources.orders.temporal[0]}::date >= date_trunc('month', now()) - interval '1 month' 
                    AND ${this.dataSources.orders.temporal[0]}::date < date_trunc('month', now())`;
                break;
            case 'this year':
                condition = `${this.dataSources.orders.temporal[0]}::date >= date_trunc('year', now())`;
                break;
            // Add more relative date conditions
        }

        return condition;
    }

    updateContext(sessionId, result, entities) {
        const context = this.getContext(sessionId);
        
        // Update state context
        if (entities.geographic) {
            context.lastState = entities.geographic;
        }

        // Update year context
        if (result.data.year) {
            context.lastYear = result.data.year;
        }

        // Store question
        context.questions.push({
            question: result.data.title,
            timestamp: new Date(),
            type: result.data.visualization.type
        });

        // Limit context history
        if (context.questions.length > 5) {
            context.questions.shift();
        }
    }

    logError(error, metadata) {
        // Implement error logging (could be to file, monitoring service, etc.)
        console.error('Error:', {
            timestamp: new Date(),
            error: error.message,
            type: error.name,
            metadata
        });
    }

    async executeQuery(queryPlan, sourceType) {
        try {
            const sql = this.buildSQL(queryPlan);
            console.log('Generated SQL Query:', sql);
            
            const result = await this.pgPool.query(sql);
            console.log('Query result rows:', result.rows);
            console.log('Number of rows returned:', result.rows.length);
            
            if (!result.rows || result.rows.length === 0) {
                console.log('Warning: Query returned no data');
                throw new Error('No data found for the given query');
            }
            
            // Log the structure of the first row
            if (result.rows.length > 0) {
                console.log('Sample row structure:', Object.keys(result.rows[0]));
            }
            
            return result.rows;
        } catch (error) {
            console.error('Database query error:', error);
            console.error('Error details:', {
                message: error.message,
                code: error.code,
                detail: error.detail
            });
            throw new Error(`Database query failed: ${error.message}`);
        }
    }

    buildSQL(queryPlan) {
        const select = queryPlan.select.length > 0 ? queryPlan.select.join(', ') : '*';
        let sql = `SELECT ${select} FROM ${queryPlan.from}`;
        
        if (queryPlan.where && queryPlan.where.length > 0) {
            sql += ` WHERE ${queryPlan.where.join(' AND ')}`;
        }
        
        if (queryPlan.groupBy && queryPlan.groupBy.length > 0) {
            sql += ` GROUP BY ${queryPlan.groupBy.join(', ')}`;
        }
        
        if (queryPlan.orderBy && queryPlan.orderBy.length > 0) {
            sql += ` ORDER BY ${queryPlan.orderBy.join(', ')}`;
        }
        
        if (queryPlan.limit) {
            sql += ` LIMIT ${queryPlan.limit}`;
        }
        
        return sql;
    }

    createVisualization(config, data) {
        return {
            type: 'd3',
            chartType: config.type,
            orientation: config.orientation,
            data: this.formatDataForVisualization(data, config),
            config: {
                ...config.config,
                isCurrency: this.isCurrencyData(data)
            }
        };
    }

    formatDataForVisualization(data, visualizationType) {
        switch (visualizationType.type) {
            case 'bar':
                return {
                    type: visualizationType.config.orientation === 'horizontal' ? 'bar-horizontal' : 'bar-vertical',
                    data: data.map(row => ({
                        category: row.customer_name || row.category || row.product_name,
                        value: parseFloat(row.total_sales || row.sales)
                    })),
                    config: visualizationType.config
                };

            case 'line':
                return {
                    type: 'line',
                    data: data.map(row => ({
                        x: row.month || row.date,
                        y: parseFloat(row.total_sales || row.sales)
                    })),
                    config: visualizationType.config
                };

            case 'pie':
                return {
                    type: 'pie',
                    data: data.map(row => ({
                        label: row.category || row.customer_name,
                        value: parseFloat(row.total_sales || row.sales)
                    })),
                    config: visualizationType.config
                };

            case 'scatter':
                return {
                    type: 'scatter',
                    data: data.map(row => ({
                        x: parseFloat(row.x || row.sales),
                        y: parseFloat(row.y || row.profit)
                    })),
                    config: visualizationType.config
                };

            default:
                return {
                    type: 'bar-vertical',
                    data: data,
                    config: visualizationType.config
                };
        }
    }

    generateSlide(question, visualization, analysis) {
        return {
            title: analysis.visualization.config.title,
            subtitle: analysis.visualization.config.subtitle,
            visualization,
            explanation: analysis.explanation
        };
    }

    isCurrencyData(data) {
        return data.some(row => 
            row.hasOwnProperty('sales') || 
            row.hasOwnProperty('profit')
        );
    }

    generateTitle(question, entities) {
        if (!entities || !entities.categorical) {
            return 'Sales Analysis';
        }
        
        const state = entities.categorical.find(e => e.field === 'state')?.value;
        return state ? 
            `Sales Analysis for ${state}` : 
            'Sales Analysis';
    }

    // Add a helper method to safely format dates
    formatDate(date) {
        try {
            if (typeof date === 'string') {
                return date.split('T')[0];
            }
            if (date instanceof Date) {
                return date.toISOString().split('T')[0];
            }
            return 'Unknown Date';
        } catch (error) {
            console.error('Date formatting error:', error);
            return 'Unknown Date';
        }
    }

    // Helper method to ensure visualization data is properly structured
    validateVisualizationData(visData) {
        if (!visData) return false;
        if (!visData.type || !visData.data || !visData.config) return false;
        if (!Array.isArray(visData.data) || visData.data.length === 0) return false;
        if (!visData.config.axes || !visData.config.axes.x || !visData.config.axes.y) return false;
        return true;
    }

    determineQuestionType(question) {
        const q = question.toLowerCase();
        
        if (q.includes('top') || q.includes('bottom')) {
            return {
                type: 'ranking',
                direction: q.includes('top') ? 'desc' : 'asc',
                limit: this.extractLimit(q)
            };
        }
        
        if (q.includes('trend') || q.includes('over time')) {
            return { type: 'trend' };
        }
        
        if (q.includes('compare') || q.includes('versus') || q.includes('vs')) {
            return { type: 'comparison' };
        }
        
        if (q.includes('distribution') || q.includes('spread')) {
            return { type: 'distribution' };
        }
        
        if (q.includes('breakdown') || q.includes('composition')) {
            return { type: 'composition' };
        }
        
        return { type: 'general' };
    }

    buildQueryPlanForType(questionType, entities) {
        try {
            const queryPlan = {
                select: [],
                from: 'orders',
                where: [],
                groupBy: [],
                orderBy: [],
                limit: null
            };

            switch (questionType.type) {
                case 'ranking':
                    queryPlan.select = ['customer_name', 'SUM(sales) as total_sales'];
                    queryPlan.groupBy = ['customer_name'];
                    queryPlan.orderBy = [`total_sales ${questionType.direction || 'DESC'}`];
                    queryPlan.limit = questionType.limit || 5;
                    break;
                
                case 'trend':
                    queryPlan.select = ['DATE_TRUNC(\'month\', order_date) as month', 'SUM(sales) as total_sales'];
                    queryPlan.groupBy = ['month'];
                    queryPlan.orderBy = ['month ASC'];
                    break;
                
                default:
                    queryPlan.select = ['DATE_TRUNC(\'month\', order_date) as month', 'SUM(sales) as total_sales'];
                    queryPlan.groupBy = ['month'];
                    queryPlan.orderBy = ['month ASC'];
            }

            // Add geographic filter if present
            if (entities.geographic) {
                queryPlan.where.push(`state = '${entities.geographic}'`);
            }

            // Add temporal filter if present
            const dateFilter = entities.temporal ? this.buildDateFilter(entities.temporal) : null;
            if (dateFilter) {
                queryPlan.where.push(dateFilter);
            }

            return queryPlan;
        } catch (error) {
            console.error('Error in buildQueryPlanForType:', error);
            // Return a safe default query plan
            return {
                select: ['customer_name', 'SUM(sales) as total_sales'],
                from: 'orders',
                where: [],
                groupBy: ['customer_name'],
                orderBy: ['total_sales DESC'],
                limit: 5
            };
        }
    }

    generateVisualizationConfig(questionType, entities, data) {
        const config = {
            title: this.generateTitle(questionType, entities),
            subtitle: this.generateSubtitle(questionType, entities, data),
            type: this.getVisualizationType(questionType),
            xAxis: { label: '', format: '' },
            yAxis: { label: '', format: '' }
        };

        switch (questionType.type) {
            case 'ranking':
                config.type = 'horizontal-bar';
                config.xAxis = { label: 'Sales ($)', format: 'currency' };
                config.yAxis = { label: this.getDimensionLabel(entities), format: 'text' };
                break;
            
            case 'trend':
                config.type = 'line';
                config.xAxis = { label: 'Date', format: 'date' };
                config.yAxis = { label: 'Sales ($)', format: 'currency' };
                break;
            
            // Add other cases as needed
        }

        return config;
    }

    generateTitle(questionType, entities) {
        const metric = entities.metric || 'Sales';
        const geography = entities.geographic ? ` in ${entities.geographic}` : '';
        const timeframe = entities.temporal ? ` for ${entities.temporal}` : '';
        
        switch (questionType.type) {
            case 'ranking':
                return `Top ${questionType.limit} by ${metric}${geography}${timeframe}`;
            case 'trend':
                return `${metric} Trend${geography}${timeframe}`;
            case 'comparison':
                return `${metric} Comparison${geography}${timeframe}`;
            default:
                return `${metric} Analysis${geography}${timeframe}`;
        }
    }

    generateSubtitle(questionType, entities, data) {
        switch (questionType.type) {
            case 'ranking':
                return `Ranked by ${entities.metric || 'sales'}`;
            case 'trend':
                const dateRange = this.getDateRange(data);
                return `From ${dateRange.start} to ${dateRange.end}`;
            default:
                return '';
        }
    }

    formatDataForVisualization(data, visType) {
        switch (visType) {
            case 'horizontal-bar':
                return data.map(row => ({
                    label: row.customer_name || row.product_name || row.category,
                    value: parseFloat(row.total_sales)
                }));
            
            case 'line':
                return data.map(row => ({
                    x: row.month,
                    y: parseFloat(row.total_sales)
                }));
            
            // Add other visualization type formatting as needed
            
            default:
                return data;
        }
    }

    getVisualizationType(questionType) {
        switch (questionType.type) {
            case 'ranking':
                return 'horizontal-bar';
            case 'trend':
                return 'line';
            case 'comparison':
                return 'bar-horizontal';
            case 'distribution':
                return 'histogram';
            case 'composition':
                return 'pie';
            default:
                return 'bar-vertical';
        }
    }

    getDimensionLabel(entities) {
        if (entities.categorical) {
            const label = entities.categorical.find(e => e.field === 'customer_name')?.value || 'Customer';
            return label;
        }
        return 'Sales';
    }

    getDateRange(data) {
        const sortedData = [...data].sort((a, b) => {
            const dateA = a.month instanceof Date ? a.month : new Date(a.month);
            const dateB = b.month instanceof Date ? b.month : new Date(b.month);
            return dateA - dateB;
        });
        const start = sortedData[0].month;
        const end = sortedData[sortedData.length - 1].month;
        return { start, end };
    }

    extractLimit(question) {
        const match = question.match(/\btop\s+(\d+)\b/i);
        return match ? parseInt(match[1]) : null;
    }

    buildDateFilter(temporal) {
        // Guard clause for undefined temporal
        if (!temporal) {
            return null;
        }

        try {
            const value = temporal.value ? temporal.value.toLowerCase() : null;
            if (!value) {
                return null;
            }

            // Handle different date formats
            if (value.match(/\d{4}-\d{2}-\d{2}/)) {
                // Exact date
                return `order_date::date = '${value}'`;
            } else if (value.includes('last')) {
                // Relative dates
                return this.buildRelativeDateCondition(value);
            } else if (value.includes('between')) {
                // Date ranges
                return this.buildDateRangeCondition(value);
            }

            return null;
        } catch (error) {
            console.error('Error in buildDateFilter:', error);
            return null;
        }
    }

    buildDateRangeCondition(range) {
        const [start, end] = range.split('between').map(part => part.trim());
        return `order_date::date >= '${start}' AND order_date::date < '${end}'`;
    }

    extractComparisonStates(question) {
        const q = question.toLowerCase();
        let states = [];
        
        // Look for "X vs Y" pattern
        const vsMatch = q.match(/(\w+)\s+(?:vs|versus)\s+(\w+)/i);
        if (vsMatch) {
            states = [vsMatch[1], vsMatch[2]];
        }
        
        // Look for "between X and Y" pattern
        const betweenMatch = q.match(/between\s+(\w+)\s+and\s+(\w+)/i);
        if (betweenMatch) {
            states = [betweenMatch[1], betweenMatch[2]];
        }
        
        // Clean and capitalize state names
        return states.map(state => 
            state.trim().charAt(0).toUpperCase() + state.trim().slice(1).toLowerCase()
        );
    }

    calculateMultiSeriesInsights(groupedData) {
        const insights = [];
        
        for (const [state, data] of Object.entries(groupedData)) {
            if (data.length === 0) continue;
            
            const totalSales = data.reduce((sum, d) => sum + d.y, 0);
            const avgSales = totalSales / data.length;
            const maxSales = Math.max(...data.map(d => d.y));
            const minSales = Math.min(...data.map(d => d.y));
            
            insights.push(
                `${state}:\n` +
                `• Average monthly sales: $${avgSales.toLocaleString('en-US', { maximumFractionDigits: 0 })}\n` +
                `• Highest sales: $${maxSales.toLocaleString('en-US', { maximumFractionDigits: 0 })}\n` +
                `• Lowest sales: $${minSales.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
            );
        }
        
        return insights.join('\n\n');
    }

    extractYear(question) {
        // Match four-digit year patterns
        const yearPattern = /\b(19|20)\d{2}\b/;
        const match = question.match(yearPattern);
        return match ? parseInt(match[0]) : null;
    }

    // Add this helper method to format the date range for subtitles
    formatDateRange(data) {
        if (!data || data.length === 0) return '';
        const dates = data.map(d => new Date(d.month));
        const start = new Date(Math.min(...dates));
        const end = new Date(Math.max(...dates));
        return `${start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} to ${end.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
    }

    calculateRankingInsights(data, year) {
        if (!data || data.length === 0) {
            return 'No data available for insights.';
        }

        const totalSales = data.reduce((sum, row) => sum + parseFloat(row.total_sales), 0);
        const avgSales = totalSales / data.length;
        const topCustomer = data[0];
        const yearText = year ? ` in ${year}` : '';

        return [
            `Total sales${yearText}: $${totalSales.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
            `Average sales per customer: $${avgSales.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
            `Top customer${yearText}: ${topCustomer.customer_name} ($${parseFloat(topCustomer.total_sales).toLocaleString('en-US', { maximumFractionDigits: 0 })})`
        ].join('\n');
    }
}

module.exports = ModelContextProtocol; 