import { mount } from 'svelte';
import App from './ui/App.svelte';
import './ui/app.css';

mount(App, { target: document.getElementById('app')! });
