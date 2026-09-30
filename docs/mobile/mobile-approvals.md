# Mobile approvals (MOB-06)

The Approvals Center (`/approvals`) is the one inbox for every provider. On a phone a review opens as a full-screen sheet with the decision bar under the thumb, documents previewable in place, and a decision updates the waiting list and counts from the server's confirmed result (no optimistic approval). A stale decision is refused with the current state.

My Day shows the top waiting approvals and the waiting count from the same queue service; rows open `/approvals?approval=<provider>:<id>`. In the Group workspace rows carry their company and open the Group queue.

MOB-06 change: the search field takes its own row on phones.
