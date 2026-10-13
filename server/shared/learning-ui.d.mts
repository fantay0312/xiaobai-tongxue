export interface LearningUiBase { id: string; title: string; sourceIds: string[]; }
export type LearningUiBlock = LearningUiBase & (
  {type:'concept';body:string} |
  {type:'flashcard';front:string;back:string} |
  {type:'quiz';question:string;options:string[];answerIndex:number;explanation:string} |
  {type:'comparison';columns:string[];rows:{label:string;values:string[]}[]} |
  {type:'plan';steps:{title:string;detail:string;minutes:number}[]}
);
export interface LearningUi { version:1;summary:string;blocks:LearningUiBlock[];followUps:string[]; }
export type LearningInteraction = Record<string,{choice?:number;revealed?:boolean;checked?:number[]}>;
export function validateLearningUi(value:unknown,sources:{id:string}[]):LearningUi;
export function learningUiText(ui:LearningUi):string;
export function partialLearningSummary(raw:string):string;
export function restoreLearningInteraction(ui:LearningUi,raw:unknown):LearningInteraction;
