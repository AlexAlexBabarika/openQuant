import './styles.css';
import { mount } from 'svelte';
import Root from './Root.svelte';

const app = mount(Root, {
  target: document.getElementById('app')!,
});

export default app;
