const { GoogleGenerativeAI } = require('@google/generative-ai');
const fetch = require('node-fetch');
const { Headers } = require('node-fetch');

// Make fetch available globally
global.fetch = fetch;
global.Headers = Headers;

async function test() {
  try {
    const API_KEY = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${API_KEY}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: "Say hello!"
          }]
        }]
      })
    });

    const data = await response.json();
    console.log('Response:', data);
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
