require('dotenv').config();
const express = require('express');
const ModelContextProtocol = require('./core/ModelContextProtocol');

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use('/js', express.static('public/js'));

const mcp = new ModelContextProtocol();

app.post('/api/analyze', async (req, res) => {
    const { question, sessionId = 'default' } = req.body;
    
    try {
        const result = await mcp.processQuestion(question, sessionId);
        
        // Add explicit headers
        res.setHeader('Content-Type', 'application/json');
        
        // Send the response with proper structure
        res.json({
            success: true,
            data: {
                visualization: result.data.visualization,
                insights: result.data.insights,
                rawData: result.data.rawData
            }
        });
    } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

