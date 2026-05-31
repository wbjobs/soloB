#include "PhysicsEngine.h"
#include <algorithm>

namespace Physics {

CollisionDetector::CollisionInfo CollisionDetector::CheckAABBvsAABB(RigidBody* a, RigidBody* b) {
    CollisionInfo info;
    info.bodyA = a;
    info.bodyB = b;
    info.hasCollision = false;

    AABB aabbA = a->GetAABB();
    AABB aabbB = b->GetAABB();

    if (!aabbA.Intersects(aabbB)) {
        return info;
    }

    Vector2 overlap;
    overlap.x = std::min(aabbA.max.x, aabbB.max.x) - std::max(aabbA.min.x, aabbB.min.x);
    overlap.y = std::min(aabbA.max.y, aabbB.max.y) - std::max(aabbA.min.y, aabbB.min.y);

    if (overlap.x < overlap.y) {
        info.penetration = overlap.x;
        if (a->position.x < b->position.x) {
            info.normal = Vector2(-1.0f, 0.0f);
        } else {
            info.normal = Vector2(1.0f, 0.0f);
        }
    } else {
        info.penetration = overlap.y;
        if (a->position.y < b->position.y) {
            info.normal = Vector2(0.0f, -1.0f);
        } else {
            info.normal = Vector2(0.0f, 1.0f);
        }
    }

    info.hasCollision = true;
    return info;
}

CollisionDetector::CollisionInfo CollisionDetector::CheckCollision(RigidBody* a, RigidBody* b) {
    if (a->isStatic && b->isStatic) {
        CollisionInfo info;
        info.bodyA = a;
        info.bodyB = b;
        info.hasCollision = false;
        return info;
    }

    return CheckAABBvsAABB(a, b);
}

void CollisionDetector::ResolveCollision(CollisionInfo& info) {
    if (!info.hasCollision) return;

    RigidBody* a = info.bodyA;
    RigidBody* b = info.bodyB;

    Vector2 relVel = b->velocity - a->velocity;
    float velAlongNormal = relVel.Dot(info.normal);

    if (velAlongNormal > 0.0f) return;

    float e = std::min(a->restitution, b->restitution);

    float invMassSum = a->invMass + b->invMass;
    if (invMassSum <= 0.0f) return;

    float j = -(1.0f + e) * velAlongNormal;
    j /= invMassSum;

    Vector2 impulse = info.normal * j;

    a->velocity -= impulse * a->invMass;
    b->velocity += impulse * b->invMass;

    float percent = 0.2f;
    float slop = 0.05f;
    Vector2 correction = info.normal * std::max(info.penetration - slop, 0.0f) / invMassSum * percent;

    a->position -= correction * a->invMass;
    b->position += correction * b->invMass;
}

void CollisionDetector::ApplyFriction(CollisionInfo& info) {
    if (!info.hasCollision) return;

    RigidBody* a = info.bodyA;
    RigidBody* b = info.bodyB;

    Vector2 relVel = b->velocity - a->velocity;

    Vector2 tangent = relVel - info.normal * relVel.Dot(info.normal);
    if (tangent.LengthSquared() < 0.0001f) return;
    tangent = tangent.Normalize();

    float jt = -relVel.Dot(tangent);
    float invMassSum = a->invMass + b->invMass;

    if (invMassSum <= 0.0f) return;
    jt /= invMassSum;

    float mu = std::sqrt(a->friction * a->friction + b->friction * b->friction);
    if (mu > 0.0001f) {
        float j = -(1.0f + std::min(a->restitution, b->restitution)) * relVel.Dot(info.normal) / invMassSum;
        if (std::abs(jt) > j * mu) {
            jt = (jt > 0.0f ? 1.0f : -1.0f) * j * mu;
        }
    }

    Vector2 tangentImpulse = tangent * jt;
    a->velocity -= tangentImpulse * a->invMass;
    b->velocity += tangentImpulse * b->invMass;
}

bool CollisionDetector::RaycastAABB(
    const AABB& aabb,
    const Vector2& rayOrigin,
    const Vector2& rayDir,
    float& tMin,
    Vector2& normal
) {
    tMin = 0.0f;
    float tMax = 1.0f;
    normal = Vector2(0, 0);

    for (int axis = 0; axis < 2; ++axis) {
        float origin = (axis == 0) ? rayOrigin.x : rayOrigin.y;
        float dir = (axis == 0) ? rayDir.x : rayDir.y;
        float aabbMin = (axis == 0) ? aabb.min.x : aabb.min.y;
        float aabbMax = (axis == 0) ? aabb.max.x : aabb.max.y;

        float invDir = 0.0f;
        if (std::abs(dir) > 0.0001f) {
            invDir = 1.0f / dir;
        } else {
            if (origin < aabbMin || origin > aabbMax) {
                return false;
            }
            continue;
        }

        float t1 = (aabbMin - origin) * invDir;
        float t2 = (aabbMax - origin) * invDir;

        Vector2 axisNormal(0, 0);
        if (t1 > t2) {
            std::swap(t1, t2);
            if (axis == 0) {
                axisNormal = Vector2(1.0f, 0.0f);
            } else {
                axisNormal = Vector2(0.0f, 1.0f);
            }
        } else {
            if (axis == 0) {
                axisNormal = Vector2(-1.0f, 0.0f);
            } else {
                axisNormal = Vector2(0.0f, -1.0f);
            }
        }

        if (t1 > tMin) {
            tMin = t1;
            normal = axisNormal;
        }

        if (t2 < tMax) {
            tMax = t2;
        }

        if (tMin > tMax) {
            return false;
        }
    }

    return tMin <= 1.0f && tMin >= 0.0f;
}

CollisionDetector::ContinuousCollisionInfo CollisionDetector::CheckContinuousCollision(
    RigidBody* body,
    const Vector2& displacement,
    RigidBody* other
) {
    ContinuousCollisionInfo result;
    result.bodyA = body;
    result.bodyB = other;
    result.t = 1.0f;
    result.hasCollision = false;

    if (body->isStatic) {
        return result;
    }

    if (displacement.LengthSquared() < 0.0001f) {
        return result;
    }

    AABB sweptAABB = body->GetSweptAABB(displacement);
    AABB otherAABB = other->GetAABB();

    if (!sweptAABB.Intersects(otherAABB)) {
        return result;
    }

    Vector2 bodyHalfExtents = body->GetHalfExtents();
    Vector2 otherHalfExtents = other->GetHalfExtents();
    AABB expandedAABB = AABB(
        otherAABB.min - bodyHalfExtents,
        otherAABB.max + bodyHalfExtents
    );

    float tHit;
    Vector2 hitNormal;

    Vector2 startCenter = body->position;
    Vector2 rayDir = displacement;

    if (RaycastAABB(expandedAABB, startCenter, rayDir, tHit, hitNormal)) {
        if (tHit >= 0.0f && tHit <= 1.0f) {
            result.t = tHit;
            result.normal = hitNormal;
            result.hasCollision = true;
        }
    }

    return result;
}

}
