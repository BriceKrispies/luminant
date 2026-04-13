(module
  ;; =========================================================
  ;; LUMINANT ENGINE CORE
  ;; =========================================================
  ;; Memory: 16 pages (1 MB)
  ;;
  ;; LAYOUT
  ;; -------
  ;; Entities:     0x000000 .. 0x03FFFF  (4096 × 64 bytes)
  ;; Grid cells:   0x040000 .. 0x07FFFF  (4096 cells × 16 slots × 4B)
  ;; Grid counts:  0x080000 .. 0x083FFF  (4096 cells × 4B)
  ;; Globals:      0x084000 .. 0x0840FF  (256B shared state)
  ;; Query buf:    0x084100 .. 0x0844FF  (256 i32 results)
  ;; Metrics:      0x084500 .. 0x0845FF  (64B counters)
  ;;
  ;; ENTITY STRIDE = 64 bytes (16 fields × 4B)
  ;; -------
  ;;  +0  x          f32   world x
  ;;  +4  y          f32   world y
  ;;  +8  vx         f32   velocity x
  ;; +12  vy         f32   velocity y
  ;; +16  hp         f32   current health
  ;; +20  max_hp     f32   maximum health
  ;; +24  type       i32   entity type enum
  ;; +28  state      i32   0=free 1=active 2=dying
  ;; +32  radius     f32   collision radius
  ;; +36  damage     f32   contact/attack damage
  ;; +40  speed      f32   movement speed (units/sec)
  ;; +44  xp_value   f32   XP awarded on kill
  ;; +48  cooldown   f32   attack cooldown timer
  ;; +52  facing     f32   facing angle (radians)
  ;; +56  flags      i32   bitfield
  ;; +60  lifetime   f32   remaining lifetime (projectiles)
  ;;
  ;; TYPE ENUM
  ;; -------
  ;;  0  = unused          10 = projectile_bullet
  ;;  1  = player           11 = projectile_spread
  ;;  2  = enemy_basic      12 = projectile_aoe_ring
  ;;  3  = enemy_fast       20 = pickup_xp
  ;;  4  = enemy_tank       21 = pickup_health
  ;;  5  = enemy_ranged
  ;;
  ;; SPATIAL GRID
  ;; -------
  ;; 64 × 64 cells, cell size = world / 64
  ;; Each cell holds up to 16 entity IDs
  ;; =========================================================

  (memory (export "memory") 16)

  ;; ===================== MUTABLE GLOBALS ====================
  (global $g_player_id  (mut i32) (i32.const -1))
  (global $g_input_dx   (mut f32) (f32.const 0))
  (global $g_input_dy   (mut f32) (f32.const 0))
  (global $g_input_atk  (mut i32) (i32.const 0))
  (global $g_active     (mut i32) (i32.const 0))
  (global $g_time       (mut f32) (f32.const 0))
  (global $g_kills      (mut i32) (i32.const 0))
  (global $g_col_checks (mut i32) (i32.const 0))
  (global $g_dmg_events (mut i32) (i32.const 0))
  (global $g_atk_flag   (mut i32) (i32.const 0))
  (global $g_world_w    (mut f32) (f32.const 4096))
  (global $g_world_h    (mut f32) (f32.const 4096))
  (global $g_qcount     (mut i32) (i32.const 0))

  ;; ===================== INIT ===============================
  (func (export "init") (param $ww f32) (param $wh f32)
    (local $i i32)
    ;; Zero entity pool (0x00000 .. 0x40000)
    (local.set $i (i32.const 0))
    (block $d (loop $l
      (br_if $d (i32.ge_u (local.get $i) (i32.const 0x40000)))
      (i32.store (local.get $i) (i32.const 0))
      (local.set $i (i32.add (local.get $i) (i32.const 4)))
      (br $l)
    ))
    (global.set $g_world_w (local.get $ww))
    (global.set $g_world_h (local.get $wh))
    (global.set $g_player_id (i32.const -1))
    (global.set $g_active (i32.const 0))
    (global.set $g_time (f32.const 0))
    (global.set $g_atk_flag (i32.const 0))
    (global.set $g_kills (i32.const 0))
  )

  ;; ===================== SPAWN ENTITY =======================
  ;; Returns slot index or -1 if pool is full.
  (func (export "spawn_entity")
    (param $type i32) (param $x f32) (param $y f32)
    (param $hp f32) (param $spd f32) (param $rad f32)
    (param $dmg f32) (param $xpv f32)
    (result i32)
    (local $i i32)
    (local $a i32)
    (local.set $i (i32.const 0))
    (block $found
      (block $full
        (loop $scan
          (br_if $full (i32.ge_u (local.get $i) (i32.const 4096)))
          (local.set $a (i32.shl (local.get $i) (i32.const 6)))
          (br_if $found (i32.eqz (i32.load offset=28 (local.get $a))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $scan)
        )
      )
      (return (i32.const -1))
    )
    (local.set $a (i32.shl (local.get $i) (i32.const 6)))
    (f32.store offset=0  (local.get $a) (local.get $x))
    (f32.store offset=4  (local.get $a) (local.get $y))
    (f32.store offset=8  (local.get $a) (f32.const 0))
    (f32.store offset=12 (local.get $a) (f32.const 0))
    (f32.store offset=16 (local.get $a) (local.get $hp))
    (f32.store offset=20 (local.get $a) (local.get $hp))
    (i32.store offset=24 (local.get $a) (local.get $type))
    (i32.store offset=28 (local.get $a) (i32.const 1))
    (f32.store offset=32 (local.get $a) (local.get $rad))
    (f32.store offset=36 (local.get $a) (local.get $dmg))
    (f32.store offset=40 (local.get $a) (local.get $spd))
    (f32.store offset=44 (local.get $a) (local.get $xpv))
    (f32.store offset=48 (local.get $a) (f32.const 0))
    (f32.store offset=52 (local.get $a) (f32.const 0))
    (i32.store offset=56 (local.get $a) (i32.const 0))
    (f32.store offset=60 (local.get $a) (f32.const 0))
    (global.set $g_active (i32.add (global.get $g_active) (i32.const 1)))
    (local.get $i)
  )

  ;; ===================== DESPAWN ENTITY =====================
  (func (export "despawn_entity") (param $id i32)
    (local $a i32)
    (local.set $a (i32.shl (local.get $id) (i32.const 6)))
    (if (i32.load offset=28 (local.get $a))
      (then (global.set $g_active (i32.sub (global.get $g_active) (i32.const 1))))
    )
    (i32.store offset=28 (local.get $a) (i32.const 0))
  )

  ;; ===================== INPUT / ACCESSORS ==================
  (func (export "set_player_input") (param $dx f32) (param $dy f32) (param $atk i32)
    (global.set $g_input_dx (local.get $dx))
    (global.set $g_input_dy (local.get $dy))
    (global.set $g_input_atk (local.get $atk))
  )
  (func (export "set_player_id") (param $id i32)
    (global.set $g_player_id (local.get $id))
  )
  (func (export "get_player_id") (result i32) (global.get $g_player_id))
  (func (export "get_active_count") (result i32) (global.get $g_active))
  (func (export "get_time") (result f32) (global.get $g_time))
  (func (export "get_kills") (result i32) (global.get $g_kills))
  (func (export "get_attack_flag") (result i32) (global.get $g_atk_flag))
  (func (export "clear_attack_flag") (global.set $g_atk_flag (i32.const 0)))
  (func (export "get_query_result") (param $idx i32) (result i32)
    (i32.load (i32.add (i32.const 0x84100) (i32.shl (local.get $idx) (i32.const 2))))
  )

  ;; ===================== APPLY DAMAGE =======================
  (func (export "apply_damage") (param $id i32) (param $amt f32)
    (local $a i32)
    (local.set $a (i32.shl (local.get $id) (i32.const 6)))
    (f32.store offset=16 (local.get $a)
      (f32.sub (f32.load offset=16 (local.get $a)) (local.get $amt))
    )
    (global.set $g_dmg_events (i32.add (global.get $g_dmg_events) (i32.const 1)))
  )

  ;; ===================== SET ENTITY VELOCITY ================
  (func (export "set_entity_velocity") (param $id i32) (param $vx f32) (param $vy f32)
    (local $a i32)
    (local.set $a (i32.shl (local.get $id) (i32.const 6)))
    (f32.store offset=8  (local.get $a) (local.get $vx))
    (f32.store offset=12 (local.get $a) (local.get $vy))
  )

  ;; ===================== SET ENTITY LIFETIME ================
  (func (export "set_entity_lifetime") (param $id i32) (param $lt f32)
    (local $a i32)
    (local.set $a (i32.shl (local.get $id) (i32.const 6)))
    (f32.store offset=60 (local.get $a) (local.get $lt))
  )

  ;; ===================== SET ENTITY FIELD ====================
  (func (export "set_entity_f32") (param $id i32) (param $off i32) (param $val f32)
    (f32.store (i32.add (i32.shl (local.get $id) (i32.const 6)) (local.get $off)) (local.get $val))
  )
  (func (export "set_entity_i32") (param $id i32) (param $off i32) (param $val i32)
    (i32.store (i32.add (i32.shl (local.get $id) (i32.const 6)) (local.get $off)) (local.get $val))
  )

  ;; ===================== REBUILD SPATIAL GRID ================
  (func $rebuild_grid (export "rebuild_grid")
    (local $i i32) (local $a i32)
    (local $cx i32) (local $cy i32) (local $ci i32)
    (local $cnt i32) (local $ga i32)
    ;; Clear grid counts
    (local.set $i (i32.const 0))
    (block $cd (loop $cl
      (br_if $cd (i32.ge_u (local.get $i) (i32.const 16384)))
      (i32.store (i32.add (i32.const 0x80000) (local.get $i)) (i32.const 0))
      (local.set $i (i32.add (local.get $i) (i32.const 4)))
      (br $cl)
    ))
    ;; Insert active entities
    (local.set $i (i32.const 0))
    (block $ed (loop $el
      (br_if $ed (i32.ge_u (local.get $i) (i32.const 4096)))
      (local.set $a (i32.shl (local.get $i) (i32.const 6)))
      (if (i32.eq (i32.load offset=28 (local.get $a)) (i32.const 1))
        (then
          ;; cell coords
          (local.set $cx (i32.trunc_f32_s (f32.div (f32.load offset=0 (local.get $a)) (f32.const 64.0))))
          (local.set $cy (i32.trunc_f32_s (f32.div (f32.load offset=4 (local.get $a)) (f32.const 64.0))))
          (local.set $cx (select (i32.const 0) (local.get $cx) (i32.lt_s (local.get $cx) (i32.const 0))))
          (local.set $cx (select (i32.const 63) (local.get $cx) (i32.gt_s (local.get $cx) (i32.const 63))))
          (local.set $cy (select (i32.const 0) (local.get $cy) (i32.lt_s (local.get $cy) (i32.const 0))))
          (local.set $cy (select (i32.const 63) (local.get $cy) (i32.gt_s (local.get $cy) (i32.const 63))))
          (local.set $ci (i32.add (i32.shl (local.get $cy) (i32.const 6)) (local.get $cx)))
          ;; read count
          (local.set $cnt (i32.load (i32.add (i32.const 0x80000) (i32.shl (local.get $ci) (i32.const 2)))))
          (if (i32.lt_u (local.get $cnt) (i32.const 16))
            (then
              (local.set $ga (i32.add (i32.const 0x40000)
                (i32.shl (i32.add (i32.shl (local.get $ci) (i32.const 4)) (local.get $cnt)) (i32.const 2))
              ))
              (i32.store (local.get $ga) (local.get $i))
              (i32.store (i32.add (i32.const 0x80000) (i32.shl (local.get $ci) (i32.const 2)))
                (i32.add (local.get $cnt) (i32.const 1))
              )
            )
          )
        )
      )
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $el)
    ))
  )

  ;; ===================== UPDATE PLAYER ======================
  (func $update_player (export "update_player") (param $dt f32)
    (local $a i32) (local $dx f32) (local $dy f32)
    (local $len f32) (local $spd f32) (local $x f32) (local $y f32)
    (if (i32.lt_s (global.get $g_player_id) (i32.const 0)) (then (return)))
    (local.set $a (i32.shl (global.get $g_player_id) (i32.const 6)))
    (if (i32.ne (i32.load offset=28 (local.get $a)) (i32.const 1)) (then (return)))

    (local.set $dx (global.get $g_input_dx))
    (local.set $dy (global.get $g_input_dy))
    (local.set $len (f32.sqrt (f32.add
      (f32.mul (local.get $dx) (local.get $dx))
      (f32.mul (local.get $dy) (local.get $dy))
    )))
    (if (f32.gt (local.get $len) (f32.const 0.001))
      (then
        (local.set $dx (f32.div (local.get $dx) (local.get $len)))
        (local.set $dy (f32.div (local.get $dy) (local.get $len)))
      )
      (else
        (local.set $dx (f32.const 0))
        (local.set $dy (f32.const 0))
      )
    )
    (local.set $spd (f32.load offset=40 (local.get $a)))
    (f32.store offset=8  (local.get $a) (f32.mul (local.get $dx) (local.get $spd)))
    (f32.store offset=12 (local.get $a) (f32.mul (local.get $dy) (local.get $spd)))

    (local.set $x (f32.add (f32.load offset=0 (local.get $a))
      (f32.mul (f32.load offset=8 (local.get $a)) (local.get $dt))))
    (local.set $y (f32.add (f32.load offset=4 (local.get $a))
      (f32.mul (f32.load offset=12 (local.get $a)) (local.get $dt))))
    (local.set $x (f32.max (f32.const 0) (f32.min (local.get $x) (global.get $g_world_w))))
    (local.set $y (f32.max (f32.const 0) (f32.min (local.get $y) (global.get $g_world_h))))
    (f32.store offset=0 (local.get $a) (local.get $x))
    (f32.store offset=4 (local.get $a) (local.get $y))

    (if (global.get $g_input_atk) (then (global.set $g_atk_flag (i32.const 1))))
  )

  ;; ===================== UPDATE ENEMIES =====================
  ;; Direct pursuit toward player + same-cell separation.
  (func $update_enemies (export "update_enemies") (param $dt f32)
    (local $i i32) (local $a i32) (local $tp i32)
    (local $pa i32) (local $px f32) (local $py f32)
    (local $ex f32) (local $ey f32) (local $spd f32)
    (local $dx f32) (local $dy f32) (local $len f32)
    (local $sx f32) (local $sy f32)
    (local $cx i32) (local $cy i32) (local $ci i32)
    (local $cnt i32) (local $k i32)
    (local $oid i32) (local $oa i32)
    (local $ox f32) (local $oy f32)
    (local $sdx f32) (local $sdy f32) (local $dist f32)
    (local $md f32) (local $push f32)
    (local $vx f32) (local $vy f32) (local $cd f32)

    (if (i32.lt_s (global.get $g_player_id) (i32.const 0)) (then (return)))
    (local.set $pa (i32.shl (global.get $g_player_id) (i32.const 6)))
    (if (i32.ne (i32.load offset=28 (local.get $pa)) (i32.const 1)) (then (return)))
    (local.set $px (f32.load offset=0 (local.get $pa)))
    (local.set $py (f32.load offset=4 (local.get $pa)))

    (local.set $i (i32.const 0))
    (block $end (loop $lp
      (br_if $end (i32.ge_u (local.get $i) (i32.const 4096)))
      (local.set $a (i32.shl (local.get $i) (i32.const 6)))
      (if (i32.eq (i32.load offset=28 (local.get $a)) (i32.const 1))
        (then
          (local.set $tp (i32.load offset=24 (local.get $a)))
          (if (i32.and (i32.ge_u (local.get $tp) (i32.const 2))
                       (i32.le_u (local.get $tp) (i32.const 9)))
            (then
              ;; cooldown tick
              (local.set $cd (f32.load offset=48 (local.get $a)))
              (if (f32.gt (local.get $cd) (f32.const 0))
                (then (f32.store offset=48 (local.get $a) (f32.sub (local.get $cd) (local.get $dt))))
              )
              ;; position / speed
              (local.set $ex (f32.load offset=0 (local.get $a)))
              (local.set $ey (f32.load offset=4 (local.get $a)))
              (local.set $spd (f32.load offset=40 (local.get $a)))

              ;; pursuit direction
              (local.set $dx (f32.sub (local.get $px) (local.get $ex)))
              (local.set $dy (f32.sub (local.get $py) (local.get $ey)))
              (local.set $len (f32.sqrt (f32.add
                (f32.mul (local.get $dx) (local.get $dx))
                (f32.mul (local.get $dy) (local.get $dy)))))
              (if (f32.gt (local.get $len) (f32.const 1.0))
                (then
                  (local.set $dx (f32.div (local.get $dx) (local.get $len)))
                  (local.set $dy (f32.div (local.get $dy) (local.get $len)))
                )
                (else (local.set $dx (f32.const 0)) (local.set $dy (f32.const 0)))
              )

              ;; === separation (same cell) ===
              (local.set $sx (f32.const 0))
              (local.set $sy (f32.const 0))
              (local.set $cx (i32.trunc_f32_s (f32.div (local.get $ex) (f32.const 64.0))))
              (local.set $cy (i32.trunc_f32_s (f32.div (local.get $ey) (f32.const 64.0))))
              (local.set $cx (select (i32.const 0) (local.get $cx) (i32.lt_s (local.get $cx) (i32.const 0))))
              (local.set $cx (select (i32.const 63) (local.get $cx) (i32.gt_s (local.get $cx) (i32.const 63))))
              (local.set $cy (select (i32.const 0) (local.get $cy) (i32.lt_s (local.get $cy) (i32.const 0))))
              (local.set $cy (select (i32.const 63) (local.get $cy) (i32.gt_s (local.get $cy) (i32.const 63))))
              (local.set $ci (i32.add (i32.shl (local.get $cy) (i32.const 6)) (local.get $cx)))
              (local.set $cnt (i32.load (i32.add (i32.const 0x80000) (i32.shl (local.get $ci) (i32.const 2)))))
              (local.set $md (f32.mul (f32.load offset=32 (local.get $a)) (f32.const 2.5)))

              (local.set $k (i32.const 0))
              (block $se (loop $sl
                (br_if $se (i32.ge_u (local.get $k) (local.get $cnt)))
                (local.set $oid (i32.load (i32.add (i32.const 0x40000)
                  (i32.shl (i32.add (i32.shl (local.get $ci) (i32.const 4)) (local.get $k)) (i32.const 2)))))
                (if (i32.ne (local.get $oid) (local.get $i))
                  (then
                    (local.set $oa (i32.shl (local.get $oid) (i32.const 6)))
                    (if (i32.and
                          (i32.eq (i32.load offset=28 (local.get $oa)) (i32.const 1))
                          (i32.and (i32.ge_u (i32.load offset=24 (local.get $oa)) (i32.const 2))
                                   (i32.le_u (i32.load offset=24 (local.get $oa)) (i32.const 9))))
                      (then
                        (local.set $ox (f32.load offset=0 (local.get $oa)))
                        (local.set $oy (f32.load offset=4 (local.get $oa)))
                        (local.set $sdx (f32.sub (local.get $ex) (local.get $ox)))
                        (local.set $sdy (f32.sub (local.get $ey) (local.get $oy)))
                        (local.set $dist (f32.sqrt (f32.add
                          (f32.mul (local.get $sdx) (local.get $sdx))
                          (f32.mul (local.get $sdy) (local.get $sdy)))))
                        (if (i32.and (f32.lt (local.get $dist) (local.get $md))
                                     (f32.gt (local.get $dist) (f32.const 0.1)))
                          (then
                            (local.set $push (f32.div
                              (f32.sub (local.get $md) (local.get $dist))
                              (local.get $dist)))
                            (local.set $sx (f32.add (local.get $sx)
                              (f32.mul (f32.div (local.get $sdx) (local.get $dist)) (local.get $push))))
                            (local.set $sy (f32.add (local.get $sy)
                              (f32.mul (f32.div (local.get $sdy) (local.get $dist)) (local.get $push))))
                          )
                        )
                      )
                    )
                  )
                )
                (local.set $k (i32.add (local.get $k) (i32.const 1)))
                (br $sl)
              ))

              ;; combine pursuit + separation
              (local.set $vx (f32.add (local.get $dx) (f32.mul (local.get $sx) (f32.const 0.5))))
              (local.set $vy (f32.add (local.get $dy) (f32.mul (local.get $sy) (f32.const 0.5))))
              (local.set $len (f32.sqrt (f32.add
                (f32.mul (local.get $vx) (local.get $vx))
                (f32.mul (local.get $vy) (local.get $vy)))))
              (if (f32.gt (local.get $len) (f32.const 0.001))
                (then
                  (local.set $vx (f32.mul (f32.div (local.get $vx) (local.get $len)) (local.get $spd)))
                  (local.set $vy (f32.mul (f32.div (local.get $vy) (local.get $len)) (local.get $spd)))
                )
              )
              (f32.store offset=8  (local.get $a) (local.get $vx))
              (f32.store offset=12 (local.get $a) (local.get $vy))

              ;; update position + clamp
              (local.set $ex (f32.add (local.get $ex) (f32.mul (local.get $vx) (local.get $dt))))
              (local.set $ey (f32.add (local.get $ey) (f32.mul (local.get $vy) (local.get $dt))))
              (local.set $ex (f32.max (f32.const 0) (f32.min (local.get $ex) (global.get $g_world_w))))
              (local.set $ey (f32.max (f32.const 0) (f32.min (local.get $ey) (global.get $g_world_h))))
              (f32.store offset=0 (local.get $a) (local.get $ex))
              (f32.store offset=4 (local.get $a) (local.get $ey))
            )
          )
        )
      )
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $lp)
    ))
  )

  ;; ===================== UPDATE PROJECTILES =================
  (func $update_projectiles (export "update_projectiles") (param $dt f32)
    (local $i i32) (local $a i32) (local $tp i32)
    (local $x f32) (local $y f32) (local $lt f32)
    (local.set $i (i32.const 0))
    (block $end (loop $lp
      (br_if $end (i32.ge_u (local.get $i) (i32.const 4096)))
      (local.set $a (i32.shl (local.get $i) (i32.const 6)))
      (if (i32.eq (i32.load offset=28 (local.get $a)) (i32.const 1))
        (then
          (local.set $tp (i32.load offset=24 (local.get $a)))
          (if (i32.and (i32.ge_u (local.get $tp) (i32.const 10))
                       (i32.le_u (local.get $tp) (i32.const 19)))
            (then
              ;; move
              (local.set $x (f32.add (f32.load offset=0 (local.get $a))
                (f32.mul (f32.load offset=8 (local.get $a)) (local.get $dt))))
              (local.set $y (f32.add (f32.load offset=4 (local.get $a))
                (f32.mul (f32.load offset=12 (local.get $a)) (local.get $dt))))
              (f32.store offset=0 (local.get $a) (local.get $x))
              (f32.store offset=4 (local.get $a) (local.get $y))
              ;; lifetime
              (local.set $lt (f32.sub (f32.load offset=60 (local.get $a)) (local.get $dt)))
              (f32.store offset=60 (local.get $a) (local.get $lt))
              ;; despawn if expired or OOB
              (if (i32.or
                    (f32.le (local.get $lt) (f32.const 0))
                    (i32.or
                      (i32.or (f32.lt (local.get $x) (f32.const -100))
                              (f32.gt (local.get $x) (f32.const 4196)))
                      (i32.or (f32.lt (local.get $y) (f32.const -100))
                              (f32.gt (local.get $y) (f32.const 4196)))
                    ))
                (then
                  (i32.store offset=28 (local.get $a) (i32.const 0))
                  (global.set $g_active (i32.sub (global.get $g_active) (i32.const 1)))
                )
              )
            )
          )
        )
      )
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $lp)
    ))
  )

  ;; ===================== CHECK PLAYER-AREA COLLISIONS =======
  ;; Checks enemies contacting player and pickups near player.
  ;; Uses 3×3 grid neighborhood around the player cell.
  (func $check_player_collisions
    (local $pa i32) (local $px f32) (local $py f32) (local $pr f32)
    (local $cx i32) (local $cy i32)
    (local $dy2 i32) (local $dx2 i32) (local $ny i32) (local $nx i32)
    (local $ci i32) (local $cnt i32) (local $k i32)
    (local $oid i32) (local $oa i32) (local $ot i32)
    (local $ox f32) (local $oy f32) (local $or2 f32)
    (local $ddx f32) (local $ddy f32) (local $d f32) (local $md f32)

    (if (i32.lt_s (global.get $g_player_id) (i32.const 0)) (then (return)))
    (local.set $pa (i32.shl (global.get $g_player_id) (i32.const 6)))
    (if (i32.ne (i32.load offset=28 (local.get $pa)) (i32.const 1)) (then (return)))

    (local.set $px (f32.load offset=0 (local.get $pa)))
    (local.set $py (f32.load offset=4 (local.get $pa)))
    (local.set $pr (f32.load offset=32 (local.get $pa)))

    (local.set $cx (i32.trunc_f32_s (f32.div (local.get $px) (f32.const 64.0))))
    (local.set $cy (i32.trunc_f32_s (f32.div (local.get $py) (f32.const 64.0))))
    (local.set $cx (select (i32.const 0) (local.get $cx) (i32.lt_s (local.get $cx) (i32.const 0))))
    (local.set $cx (select (i32.const 63) (local.get $cx) (i32.gt_s (local.get $cx) (i32.const 63))))
    (local.set $cy (select (i32.const 0) (local.get $cy) (i32.lt_s (local.get $cy) (i32.const 0))))
    (local.set $cy (select (i32.const 63) (local.get $cy) (i32.gt_s (local.get $cy) (i32.const 63))))

    ;; 3×3 neighborhood
    (local.set $dy2 (i32.const -1))
    (block $ye (loop $yl
      (br_if $ye (i32.gt_s (local.get $dy2) (i32.const 1)))
      (local.set $ny (i32.add (local.get $cy) (local.get $dy2)))
      (if (i32.and (i32.ge_s (local.get $ny) (i32.const 0)) (i32.lt_s (local.get $ny) (i32.const 64)))
        (then
          (local.set $dx2 (i32.const -1))
          (block $xe (loop $xl
            (br_if $xe (i32.gt_s (local.get $dx2) (i32.const 1)))
            (local.set $nx (i32.add (local.get $cx) (local.get $dx2)))
            (if (i32.and (i32.ge_s (local.get $nx) (i32.const 0)) (i32.lt_s (local.get $nx) (i32.const 64)))
              (then
                (local.set $ci (i32.add (i32.shl (local.get $ny) (i32.const 6)) (local.get $nx)))
                (local.set $cnt (i32.load (i32.add (i32.const 0x80000) (i32.shl (local.get $ci) (i32.const 2)))))
                (local.set $k (i32.const 0))
                (block $ke (loop $kl
                  (br_if $ke (i32.ge_u (local.get $k) (local.get $cnt)))
                  (local.set $oid (i32.load (i32.add (i32.const 0x40000)
                    (i32.shl (i32.add (i32.shl (local.get $ci) (i32.const 4)) (local.get $k)) (i32.const 2)))))
                  (if (i32.ne (local.get $oid) (global.get $g_player_id))
                    (then
                      (local.set $oa (i32.shl (local.get $oid) (i32.const 6)))
                      (if (i32.eq (i32.load offset=28 (local.get $oa)) (i32.const 1))
                        (then
                          (local.set $ot (i32.load offset=24 (local.get $oa)))
                          (global.set $g_col_checks (i32.add (global.get $g_col_checks) (i32.const 1)))
                          (local.set $ox (f32.load offset=0 (local.get $oa)))
                          (local.set $oy (f32.load offset=4 (local.get $oa)))
                          (local.set $ddx (f32.sub (local.get $px) (local.get $ox)))
                          (local.set $ddy (f32.sub (local.get $py) (local.get $oy)))
                          (local.set $d (f32.sqrt (f32.add
                            (f32.mul (local.get $ddx) (local.get $ddx))
                            (f32.mul (local.get $ddy) (local.get $ddy)))))
                          (local.set $or2 (f32.load offset=32 (local.get $oa)))
                          (local.set $md (f32.add (local.get $pr) (local.get $or2)))

                          ;; enemy contact damage
                          (if (i32.and
                                (i32.and (i32.ge_u (local.get $ot) (i32.const 2))
                                         (i32.le_u (local.get $ot) (i32.const 9)))
                                (f32.lt (local.get $d) (local.get $md)))
                            (then
                              (if (f32.le (f32.load offset=48 (local.get $oa)) (f32.const 0))
                                (then
                                  (f32.store offset=16 (local.get $pa)
                                    (f32.sub (f32.load offset=16 (local.get $pa))
                                             (f32.load offset=36 (local.get $oa))))
                                  (f32.store offset=48 (local.get $oa) (f32.const 0.5))
                                  (global.set $g_dmg_events (i32.add (global.get $g_dmg_events) (i32.const 1)))
                                )
                              )
                            )
                          )
                          ;; pickup collection
                          (if (i32.and (i32.ge_u (local.get $ot) (i32.const 20))
                                       (f32.lt (local.get $d) (f32.add (local.get $pr) (f32.const 30.0))))
                            (then
                              (i32.store offset=28 (local.get $oa) (i32.const 2))
                            )
                          )
                        )
                      )
                    )
                  )
                  (local.set $k (i32.add (local.get $k) (i32.const 1)))
                  (br $kl)
                ))
              )
            )
            (local.set $dx2 (i32.add (local.get $dx2) (i32.const 1)))
            (br $xl)
          ))
        )
      )
      (local.set $dy2 (i32.add (local.get $dy2) (i32.const 1)))
      (br $yl)
    ))
  )

  ;; ===================== CHECK PROJECTILE COLLISIONS ========
  ;; For each projectile, check 3×3 grid for enemy hits.
  (func $check_proj_collisions
    (local $i i32) (local $a i32)
    (local $px f32) (local $py f32) (local $pr f32) (local $pdmg f32)
    (local $cx i32) (local $cy i32)
    (local $dy2 i32) (local $dx2 i32) (local $ny i32) (local $nx i32)
    (local $ci i32) (local $cnt i32) (local $k i32)
    (local $oid i32) (local $oa i32)
    (local $ox f32) (local $oy f32) (local $or2 f32)
    (local $ddx f32) (local $ddy f32) (local $d f32) (local $md f32)
    (local $hit i32)

    (local.set $i (i32.const 0))
    (block $end (loop $lp
      (br_if $end (i32.ge_u (local.get $i) (i32.const 4096)))
      (local.set $a (i32.shl (local.get $i) (i32.const 6)))
      (if (i32.and
            (i32.eq (i32.load offset=28 (local.get $a)) (i32.const 1))
            (i32.and (i32.ge_u (i32.load offset=24 (local.get $a)) (i32.const 10))
                     (i32.le_u (i32.load offset=24 (local.get $a)) (i32.const 19))))
        (then
          (local.set $px (f32.load offset=0 (local.get $a)))
          (local.set $py (f32.load offset=4 (local.get $a)))
          (local.set $pr (f32.load offset=32 (local.get $a)))
          (local.set $pdmg (f32.load offset=36 (local.get $a)))
          (local.set $hit (i32.const 0))

          (local.set $cx (i32.trunc_f32_s (f32.div (local.get $px) (f32.const 64.0))))
          (local.set $cy (i32.trunc_f32_s (f32.div (local.get $py) (f32.const 64.0))))
          (local.set $cx (select (i32.const 0) (local.get $cx) (i32.lt_s (local.get $cx) (i32.const 0))))
          (local.set $cx (select (i32.const 63) (local.get $cx) (i32.gt_s (local.get $cx) (i32.const 63))))
          (local.set $cy (select (i32.const 0) (local.get $cy) (i32.lt_s (local.get $cy) (i32.const 0))))
          (local.set $cy (select (i32.const 63) (local.get $cy) (i32.gt_s (local.get $cy) (i32.const 63))))

          (local.set $dy2 (i32.const -1))
          (block $ye (loop $yl
            (br_if $ye (i32.or (i32.gt_s (local.get $dy2) (i32.const 1)) (local.get $hit)))
            (local.set $ny (i32.add (local.get $cy) (local.get $dy2)))
            (if (i32.and (i32.ge_s (local.get $ny) (i32.const 0)) (i32.lt_s (local.get $ny) (i32.const 64)))
              (then
                (local.set $dx2 (i32.const -1))
                (block $xe (loop $xl
                  (br_if $xe (i32.or (i32.gt_s (local.get $dx2) (i32.const 1)) (local.get $hit)))
                  (local.set $nx (i32.add (local.get $cx) (local.get $dx2)))
                  (if (i32.and (i32.ge_s (local.get $nx) (i32.const 0)) (i32.lt_s (local.get $nx) (i32.const 64)))
                    (then
                      (local.set $ci (i32.add (i32.shl (local.get $ny) (i32.const 6)) (local.get $nx)))
                      (local.set $cnt (i32.load (i32.add (i32.const 0x80000)
                        (i32.shl (local.get $ci) (i32.const 2)))))
                      (local.set $k (i32.const 0))
                      (block $ke (loop $kl
                        (br_if $ke (i32.or (i32.ge_u (local.get $k) (local.get $cnt)) (local.get $hit)))
                        (local.set $oid (i32.load (i32.add (i32.const 0x40000)
                          (i32.shl (i32.add (i32.shl (local.get $ci) (i32.const 4)) (local.get $k)) (i32.const 2)))))
                        (local.set $oa (i32.shl (local.get $oid) (i32.const 6)))
                        (if (i32.and
                              (i32.eq (i32.load offset=28 (local.get $oa)) (i32.const 1))
                              (i32.and (i32.ge_u (i32.load offset=24 (local.get $oa)) (i32.const 2))
                                       (i32.le_u (i32.load offset=24 (local.get $oa)) (i32.const 9))))
                          (then
                            (global.set $g_col_checks (i32.add (global.get $g_col_checks) (i32.const 1)))
                            (local.set $ox (f32.load offset=0 (local.get $oa)))
                            (local.set $oy (f32.load offset=4 (local.get $oa)))
                            (local.set $ddx (f32.sub (local.get $px) (local.get $ox)))
                            (local.set $ddy (f32.sub (local.get $py) (local.get $oy)))
                            (local.set $d (f32.sqrt (f32.add
                              (f32.mul (local.get $ddx) (local.get $ddx))
                              (f32.mul (local.get $ddy) (local.get $ddy)))))
                            (local.set $md (f32.add (local.get $pr) (f32.load offset=32 (local.get $oa))))
                            (if (f32.lt (local.get $d) (local.get $md))
                              (then
                                ;; damage enemy
                                (f32.store offset=16 (local.get $oa)
                                  (f32.sub (f32.load offset=16 (local.get $oa)) (local.get $pdmg)))
                                ;; despawn projectile
                                (i32.store offset=28 (local.get $a) (i32.const 0))
                                (global.set $g_active (i32.sub (global.get $g_active) (i32.const 1)))
                                (global.set $g_dmg_events (i32.add (global.get $g_dmg_events) (i32.const 1)))
                                (local.set $hit (i32.const 1))
                              )
                            )
                          )
                        )
                        (local.set $k (i32.add (local.get $k) (i32.const 1)))
                        (br $kl)
                      ))
                    )
                  )
                  (local.set $dx2 (i32.add (local.get $dx2) (i32.const 1)))
                  (br $xl)
                ))
              )
            )
            (local.set $dy2 (i32.add (local.get $dy2) (i32.const 1)))
            (br $yl)
          ))
        )
      )
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $lp)
    ))
  )

  ;; ===================== PROCESS DEATHS =====================
  (func $process_deaths (export "process_deaths")
    (local $i i32) (local $a i32) (local $tp i32)
    (local.set $i (i32.const 0))
    (block $end (loop $lp
      (br_if $end (i32.ge_u (local.get $i) (i32.const 4096)))
      (local.set $a (i32.shl (local.get $i) (i32.const 6)))
      (if (i32.and
            (i32.eq (i32.load offset=28 (local.get $a)) (i32.const 1))
            (f32.le (f32.load offset=16 (local.get $a)) (f32.const 0)))
        (then
          (i32.store offset=28 (local.get $a) (i32.const 2))
          (local.set $tp (i32.load offset=24 (local.get $a)))
          (if (i32.and (i32.ge_u (local.get $tp) (i32.const 2))
                       (i32.le_u (local.get $tp) (i32.const 9)))
            (then (global.set $g_kills (i32.add (global.get $g_kills) (i32.const 1))))
          )
        )
      )
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $lp)
    ))
  )

  ;; ===================== STEP ===============================
  ;; Main simulation tick — call once per fixed-timestep frame.
  (func (export "step") (param $dt f32)
    ;; reset per-frame metrics
    (global.set $g_kills (i32.const 0))
    (global.set $g_col_checks (i32.const 0))
    (global.set $g_dmg_events (i32.const 0))
    (global.set $g_atk_flag (i32.const 0))
    ;; accumulate time
    (global.set $g_time (f32.add (global.get $g_time) (local.get $dt)))
    ;; subsystems
    (call $rebuild_grid)
    (call $update_player (local.get $dt))
    (call $update_enemies (local.get $dt))
    (call $update_projectiles (local.get $dt))
    (call $check_player_collisions)
    (call $check_proj_collisions)
    (call $process_deaths)
    ;; flush metrics to memory for JS
    (i32.store (i32.const 0x84500) (global.get $g_kills))
    (i32.store (i32.const 0x84504) (global.get $g_col_checks))
    (i32.store (i32.const 0x84508) (global.get $g_dmg_events))
    (i32.store (i32.const 0x8450c) (global.get $g_active))
    (i32.store (i32.const 0x84000) (global.get $g_player_id))
  )

  ;; ===================== GRID QUERY =========================
  ;; Returns entities within radius of (qx,qy).
  ;; Writes IDs to query buffer 0x84100, returns count.
  (func (export "grid_query") (param $qx f32) (param $qy f32) (param $qr f32) (result i32)
    (local $cnt i32)
    (local $r2 f32)
    (local $mnx i32) (local $mxx i32) (local $mny i32) (local $mxy i32)
    (local $gx i32) (local $gy i32)
    (local $ci i32) (local $cc i32) (local $k i32)
    (local $eid i32) (local $ea i32)
    (local $ddx f32) (local $ddy f32) (local $d2 f32)

    (local.set $cnt (i32.const 0))
    (local.set $r2 (f32.mul (local.get $qr) (local.get $qr)))

    (local.set $mnx (i32.trunc_f32_s (f32.div (f32.sub (local.get $qx) (local.get $qr)) (f32.const 64.0))))
    (local.set $mxx (i32.trunc_f32_s (f32.div (f32.add (local.get $qx) (local.get $qr)) (f32.const 64.0))))
    (local.set $mny (i32.trunc_f32_s (f32.div (f32.sub (local.get $qy) (local.get $qr)) (f32.const 64.0))))
    (local.set $mxy (i32.trunc_f32_s (f32.div (f32.add (local.get $qy) (local.get $qr)) (f32.const 64.0))))
    (local.set $mnx (select (i32.const 0) (local.get $mnx) (i32.lt_s (local.get $mnx) (i32.const 0))))
    (local.set $mxx (select (i32.const 63) (local.get $mxx) (i32.gt_s (local.get $mxx) (i32.const 63))))
    (local.set $mny (select (i32.const 0) (local.get $mny) (i32.lt_s (local.get $mny) (i32.const 0))))
    (local.set $mxy (select (i32.const 63) (local.get $mxy) (i32.gt_s (local.get $mxy) (i32.const 63))))

    (local.set $gy (local.get $mny))
    (block $ye (loop $yl
      (br_if $ye (i32.gt_s (local.get $gy) (local.get $mxy)))
      (local.set $gx (local.get $mnx))
      (block $xe (loop $xl
        (br_if $xe (i32.gt_s (local.get $gx) (local.get $mxx)))
        (local.set $ci (i32.add (i32.shl (local.get $gy) (i32.const 6)) (local.get $gx)))
        (local.set $cc (i32.load (i32.add (i32.const 0x80000) (i32.shl (local.get $ci) (i32.const 2)))))
        (local.set $k (i32.const 0))
        (block $ke (loop $kl
          (br_if $ke (i32.ge_u (local.get $k) (local.get $cc)))
          (local.set $eid (i32.load (i32.add (i32.const 0x40000)
            (i32.shl (i32.add (i32.shl (local.get $ci) (i32.const 4)) (local.get $k)) (i32.const 2)))))
          (local.set $ea (i32.shl (local.get $eid) (i32.const 6)))
          (if (i32.eq (i32.load offset=28 (local.get $ea)) (i32.const 1))
            (then
              (local.set $ddx (f32.sub (local.get $qx) (f32.load offset=0 (local.get $ea))))
              (local.set $ddy (f32.sub (local.get $qy) (f32.load offset=4 (local.get $ea))))
              (local.set $d2 (f32.add
                (f32.mul (local.get $ddx) (local.get $ddx))
                (f32.mul (local.get $ddy) (local.get $ddy))))
              (if (f32.le (local.get $d2) (local.get $r2))
                (then
                  (if (i32.lt_u (local.get $cnt) (i32.const 256))
                    (then
                      (i32.store (i32.add (i32.const 0x84100) (i32.shl (local.get $cnt) (i32.const 2)))
                        (local.get $eid))
                      (local.set $cnt (i32.add (local.get $cnt) (i32.const 1)))
                    )
                  )
                )
              )
            )
          )
          (local.set $k (i32.add (local.get $k) (i32.const 1)))
          (br $kl)
        ))
        (local.set $gx (i32.add (local.get $gx) (i32.const 1)))
        (br $xl)
      ))
      (local.set $gy (i32.add (local.get $gy) (i32.const 1)))
      (br $yl)
    ))
    (global.set $g_qcount (local.get $cnt))
    (local.get $cnt)
  )
)
