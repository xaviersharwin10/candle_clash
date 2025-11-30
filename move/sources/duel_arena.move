module duel_arena::duel_arena {
    use std::signer;
    use std::error;
    use aptos_framework::coin;
    use aptos_framework::event;
    use aptos_framework::timestamp;
    use aptos_framework::aptos_coin::AptosCoin;
    use aptos_framework::account;
    use aptos_std::table;

    /// Error codes
    const E_NOT_ADMIN: u64 = 1;
    const E_DUEL_NOT_FOUND: u64 = 2;
    const E_DUEL_NOT_ACTIVE: u64 = 3;
    const E_DUEL_ALREADY_RESOLVED: u64 = 4;
    const E_DUEL_NOT_EXPIRED: u64 = 5;
    const E_INVALID_WAGER: u64 = 6;
    const E_ALREADY_IN_DUEL: u64 = 7;

    /// Constants
    const GRACE_PERIOD_SECS: u64 = 60; // extra buffer after duration
    const FEE_BASIS_POINTS: u64 = 100; // 1% fee (100 bps)

    /// Admin address - backend referee / project owner
    const ADMIN_ADDRESS: address = @duel_arena;

    /// Duel state stored on-chain.
    /// Wagers are held directly in the Duel resource as Coin<AptosCoin>.
    struct Duel has key, store {
        player_1: address,
        player_2: address,
        wager_amount: u64,
        duration_secs: u64,
        start_time: u64, // 0 until duel actually starts
        is_active: bool,
        is_resolved: bool,
        pot: coin::Coin<AptosCoin>,
    }

    /// Events for off-chain indexing and UI.
    struct DuelCreatedEvent has drop, store {
        duel_id: u64,
        player_1: address,
        wager_amount: u64,
        duration_secs: u64,
    }

    struct DuelStartedEvent has drop, store {
        duel_id: u64,
        player_1: address,
        player_2: address,
    }

    struct DuelEndedEvent has drop, store {
        duel_id: u64,
        winner: address,
        payout: u64,
        fee: u64,
    }

    struct DuelRefundedEvent has drop, store {
        duel_id: u64,
    }

    /// Global store for all duels.
    struct DuelStore has key {
        next_id: u64,
        duels: table::Table<u64, Duel>,
    }

    struct DuelEvents has key {
        created: event::EventHandle<DuelCreatedEvent>,
        started: event::EventHandle<DuelStartedEvent>,
        ended: event::EventHandle<DuelEndedEvent>,
        refunded: event::EventHandle<DuelRefundedEvent>,
    }

    /// Initialize storage. Automatically called on module publish.
    fun init_module(admin: &signer) {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == ADMIN_ADDRESS, error::permission_denied(E_NOT_ADMIN));

        if (!exists<DuelStore>(ADMIN_ADDRESS)) {
            move_to(admin, DuelStore {
                next_id: 0,
                duels: table::new<u64, Duel>(),
            });
        };

        if (!exists<DuelEvents>(ADMIN_ADDRESS)) {
            let events = DuelEvents {
                created: account::new_event_handle<DuelCreatedEvent>(admin),
                started: account::new_event_handle<DuelStartedEvent>(admin),
                ended: account::new_event_handle<DuelEndedEvent>(admin),
                refunded: account::new_event_handle<DuelRefundedEvent>(admin),
            };
            move_to(admin, events);
        };
    }

    /// Player 1 creates a duel and escrows their wager.
    public entry fun create_duel(
        player: &signer,
        wager_amount: u64,
        duration_secs: u64,
    ) acquires DuelStore, DuelEvents {
        assert!(wager_amount > 0, error::invalid_argument(E_INVALID_WAGER));

        let store = borrow_global_mut<DuelStore>(ADMIN_ADDRESS);
        let events = borrow_global_mut<DuelEvents>(ADMIN_ADDRESS);

        let duel_id = store.next_id;
        store.next_id = duel_id + 1;

        let player_addr = signer::address_of(player);
        let coins = coin::withdraw<AptosCoin>(player, wager_amount);

        let duel = Duel {
            player_1: player_addr,
            player_2: @0x0,
            wager_amount,
            duration_secs,
            start_time: 0,
            is_active: false,
            is_resolved: false,
            pot: coins,
        };

        table::add(&mut store.duels, duel_id, duel);

        event::emit_event(&mut events.created, DuelCreatedEvent {
            duel_id,
            player_1: player_addr,
            wager_amount,
            duration_secs,
        });
    }

    /// Player 2 joins a duel, escrows the same wager, and starts the timer.
    public entry fun join_duel(
        player: &signer,
        duel_id: u64,
    ) acquires DuelStore, DuelEvents {
        let store = borrow_global_mut<DuelStore>(ADMIN_ADDRESS);
        let events = borrow_global_mut<DuelEvents>(ADMIN_ADDRESS);

        let duel_ref = table::borrow_mut(&mut store.duels, duel_id);
        assert!(!duel_ref.is_resolved, error::invalid_state(E_DUEL_ALREADY_RESOLVED));
        assert!(!duel_ref.is_active, error::invalid_state(E_DUEL_NOT_ACTIVE));
        assert!(duel_ref.player_2 == @0x0, error::already_exists(E_ALREADY_IN_DUEL));

        let player_addr = signer::address_of(player);
        let coins = coin::withdraw<AptosCoin>(player, duel_ref.wager_amount);

        coin::merge(&mut duel_ref.pot, coins);

        duel_ref.player_2 = player_addr;
        duel_ref.is_active = true;
        duel_ref.start_time = timestamp::now_seconds();

        event::emit_event(&mut events.started, DuelStartedEvent {
            duel_id,
            player_1: duel_ref.player_1,
            player_2: player_addr,
        });
    }

    /// Resolve a duel - callable only by ADMIN_ADDRESS (backend referee).
    /// Distributes 99% of the pot to the winner, 1% to admin.
    public entry fun resolve_duel(
        admin: &signer,
        duel_id: u64,
        winner: address,
    ) acquires DuelStore, DuelEvents {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == ADMIN_ADDRESS, error::permission_denied(E_NOT_ADMIN));

        let store = borrow_global_mut<DuelStore>(ADMIN_ADDRESS);
        let events = borrow_global_mut<DuelEvents>(ADMIN_ADDRESS);
        let duel_ref = table::borrow_mut(&mut store.duels, duel_id);

        assert!(duel_ref.is_active, error::invalid_state(E_DUEL_NOT_ACTIVE));
        assert!(!duel_ref.is_resolved, error::invalid_state(E_DUEL_ALREADY_RESOLVED));
        assert!(winner == duel_ref.player_1 || winner == duel_ref.player_2, error::invalid_argument(E_DUEL_NOT_FOUND));

        let total_pot = coin::value<AptosCoin>(&duel_ref.pot);
        let fee = (total_pot * FEE_BASIS_POINTS) / 10_000;
        let payout = total_pot - fee;

        let all_coins = coin::extract_all<AptosCoin>(&mut duel_ref.pot);
        let winner_coins = coin::extract<AptosCoin>(&mut all_coins, payout);

        coin::deposit<AptosCoin>(winner, winner_coins);
        coin::deposit<AptosCoin>(ADMIN_ADDRESS, all_coins);

        duel_ref.is_active = false;
        duel_ref.is_resolved = true;

        event::emit_event(&mut events.ended, DuelEndedEvent {
            duel_id,
            winner,
            payout,
            fee,
        });
    }

    /// Public cleanup function. If a duel has expired without resolution,
    /// anyone can refund players from the escrowed pot.
    public entry fun refund_expired(
        _caller: &signer,
        duel_id: u64,
    ) acquires DuelStore, DuelEvents {
        let store = borrow_global_mut<DuelStore>(ADMIN_ADDRESS);
        let events = borrow_global_mut<DuelEvents>(ADMIN_ADDRESS);
        let duel_ref = table::borrow_mut(&mut store.duels, duel_id);

        assert!(duel_ref.is_active, error::invalid_state(E_DUEL_NOT_ACTIVE));
        assert!(!duel_ref.is_resolved, error::invalid_state(E_DUEL_ALREADY_RESOLVED));

        let now = timestamp::now_seconds();
        let end_time = duel_ref.start_time + duel_ref.duration_secs + GRACE_PERIOD_SECS;
        assert!(now > end_time, error::invalid_state(E_DUEL_NOT_EXPIRED));

        let all_coins = coin::extract_all<AptosCoin>(&mut duel_ref.pot);

        if (duel_ref.player_2 == @0x0) {
            // Only player_1 ever joined; refund entire pot.
            coin::deposit<AptosCoin>(duel_ref.player_1, all_coins);
        } else {
            // Both joined; refund original wager_amount to each.
            let p1_refund = duel_ref.wager_amount;
            let p1_coins = coin::extract<AptosCoin>(&mut all_coins, p1_refund);
            coin::deposit<AptosCoin>(duel_ref.player_1, p1_coins);
            coin::deposit<AptosCoin>(duel_ref.player_2, all_coins);
        };

        duel_ref.is_active = false;
        duel_ref.is_resolved = true;

        event::emit_event(&mut events.refunded, DuelRefundedEvent { duel_id });
    }

    /// View helper for frontend / indexer.
    #[view]
    public fun get_duel(
        duel_id: u64
    ): (address, address, u64, u64, u64, bool, bool) acquires DuelStore {
        let store = borrow_global<DuelStore>(ADMIN_ADDRESS);
        let duel_ref = table::borrow(&store.duels, duel_id);
        (
            duel_ref.player_1,
            duel_ref.player_2,
            duel_ref.wager_amount,
            duel_ref.duration_secs,
            duel_ref.start_time,
            duel_ref.is_active,
            duel_ref.is_resolved,
        )
    }
}


