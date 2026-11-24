import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

// حالت بارگذاری ۴۸px در index.html تا اینجا دیده شده؛ پیش از mount برداشته
// می‌شود تا زیر اپ نماند (اگر JS اصلاً لود نشود، نشان سر جایش می‌ماند).
const target = document.getElementById('app')
target.innerHTML = ''

const app = mount(App, {
  target
})

export default app
