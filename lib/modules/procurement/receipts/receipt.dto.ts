/**
 * Re-exports the shared DTO helpers the receipt service uses.
 *
 * A receipt has no curtain of its own — what it shows is decided by whether the
 * reader can reach the order behind it — so there is nothing here but the
 * shared shapes (PRD #19 §238).
 */
export { dateString, toMemberRef, toSupplierRef } from "../procurement.dto";
export { quantityString } from "../procurement.money";
