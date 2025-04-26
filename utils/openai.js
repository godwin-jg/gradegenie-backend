const { OpenAI } = require("openai")
const dotenv = require("dotenv")
dotenv.config()

if (!process.env.OPENAI_API_KEY) {
  throw new Error("The OPENAI_API_KEY environment variable is missing or empty. Please provide it.");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

async function generateContent(prompt) {
  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: prompt }],
  })

  return completion.choices[0].message.content
}

module.exports = { generateContent }
