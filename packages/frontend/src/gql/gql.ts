/* eslint-disable */
import * as types from './graphql';



const documents = {}
export function graphql(source: string) {
  return (documents as Record<string, unknown>)[source] ?? {};
}
