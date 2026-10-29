import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Aurum | Inteligência para o ouro',description:'Seu terminal privado de contexto e planejamento para XAU/USD. Somente fontes reais.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
